import {
  normalizeTagList,
  sanitizeCategoryForStorage,
  type KnownCategory,
} from "@/lib/categories";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  possessiveExample,
  processingDisplayName,
  pronounsLabelFromUser,
} from "@/lib/user-profile";
import { NextResponse } from "next/server";

type ProcessedEntry = {
  text: string;
  category: KnownCategory;
  tags: string[];
};

function sanitizeCategory(value: string | undefined): KnownCategory {
  return sanitizeCategoryForStorage(value);
}

function fallbackEntries(originalText: string): {
  acknowledgment: string;
  entries: ProcessedEntry[];
} {
  return {
    acknowledgment: "Noted",
    entries: [
      {
        text: originalText,
        category: "other",
        tags: [],
      },
    ],
  };
}

/** Strip markdown fences and parse Claude's entries JSON; returns null on failure. */
function parseEntriesFromModelText(modelText: string): {
  acknowledgment?: string;
  entries?: Array<{ text?: string; category?: string; tags?: unknown }>;
} | null {
  let trimmed = modelText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/m);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(trimmed) as {
      acknowledgment?: string;
      entries?: Array<{ text?: string; category?: string; tags?: unknown }>;
    };
  } catch (error) {
    console.error(
      "[process] malformed JSON from Claude:",
      error instanceof Error ? error.message : error,
      "snippet:",
      trimmed.slice(0, 800),
    );
    return null;
  }
}

function thirdPersonInstructionBlock(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
): string {
  return `STEP 4 - Third person (apply to EACH entry after steps 1–3):
After cleaning typos, splitting multi-topic input into separate entries (if applicable), and categorizing, rewrite EVERY resulting entry's text to third person using USER NAME and USER PRONOUNS below. For multi-topic splits, perform STEP 4 independently on each split entry—do not leave any entry in first person.

USER NAME: ${userName}
USER PRONOUNS: ${pronounsLine}

PRONOUN REPLACEMENT - Be thorough. Replace ALL first-person references meant as the journal author (the user), including informal spellings and typos. Use USER NAME and the subject/object/possessive forms implied by USER PRONOUNS.

Subject pronouns and contractions (map to ${userName} + correct verb form; fix casing and apostrophes):
- I → ${userName}
- I'm, im, Im, I am → ${userName} is (or ${userName} was/were when tense requires)
- I've, ive, I have → ${userName} has or ${userName} had (match tense)
- I'll, ill, I will → ${userName} will or ${userName} would (match tense/modality)
- I'd, id → ${userName} would, ${userName} had, or ${userName} should as context requires
- Lowercase i as a subject pronoun → ${userName}

Object pronouns (use object form from USER PRONOUNS, e.g. him/her/them):
- me → him/her/them as appropriate
- myself → himself/herself/themselves as appropriate

Possessive and determiners:
- my, mine → ${userName}'s or his/her/their per USER PRONOUNS and grammar (e.g. '${examplePossessive} birthday')
- Catch informal spellings: myne, mi when clearly meaning "my/mine" → rewrite correctly

Verb conjugation after replacing I with ${userName} (third person singular/plural as appropriate):
- I am → ${userName} is (or was)
- I have → ${userName} has (or had)
- I do → ${userName} does (or did)
- I think → ${userName} thinks (or thought)
- I love → ${userName} loves (or loved)
- im glad / I'm glad → ${userName} is glad (etc.)

Multiple occurrences: If a sentence has several first-person forms (e.g. multiple "I" or "I'm"), replace ALL of them, not only the first.

Informal & typo examples (adjust pronouns to USER PRONOUNS; names below illustrate pattern):
- 'I'm glad I am 31 years old' → '${userName} is glad ${userName} is 31 years old'
- 'im going to the store' → '${userName} is going to the store'
- 'i love my wife and i think shes amazing' → '${userName} loves his wife and ${userName} thinks she's amazing' (or equivalent with her/their pronouns)
- 'me and dan bi went hiking' → '${userName} and Dan Bi went hiking' or 'Dan Bi and ${userName} went hiking'
- 'i was tired so i took a nap' → '${userName} was tired so ${userName} took a nap'
- 'me too' in author voice → '${userName} too' or rephrase (e.g. '${userName} agrees') only if it preserves meaning
- 'thats myne' → 'that's ${userName}'s' or equivalent possessive per USER PRONOUNS

Guardrails:
- Do not change words inside quotation marks if they represent someone else's speech.
- Do not change first- or second-person when the writer is clearly quoting or describing another person's words.
- Do not replace pronouns that refer to other people (e.g. "she" for the user's partner stays when it refers to that person, not the author).
- If the user already wrote their own name in the entry, avoid doubling it awkwardly (e.g. '${userName} and Dan Bi' not '${userName} and ${userName} and Dan Bi').
- Preserve meaning and tone; do not add facts that were not in the original.
- If there is genuinely no first-person author reference left to rewrite, leave wording unchanged aside from step 1 cleanup.`;
}

const TAG_EXTRACTION_BLOCK = `TAGS (for EACH entry in the entries array):
Also extract relevant tags from that entry's content. Tags should be:
- Names of specific people mentioned (e.g. Dan Bi, mom, Eugene Park)
- Specific topics or things (e.g. Abilify, NYU, Cozyberry, bipolar)
- Use consistent capitalization as in the entry when reasonable (e.g. Dan Bi not danbi)
- Don't tag generic concepts if you can tag a specific person or thing instead (don't tag "family" if you can tag the specific family member)
- Limit to 5 tags max per entry
- Use an empty array [] if the entry is too short or generic to need tags

Return tags in the JSON as shown below.`;

function buildAutoSystemPrompt(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
): string {
  return `You are processing journal entries for a personal memory app. Process the input through these steps:

STEP 1 - Clean the text:
- Fix typos and spelling errors
- Remove duplicated/stuttered phrases (e.g., 'he is he is' becomes 'he is')
- Fix broken grammar
- Preserve the user's voice and meaning - do not paraphrase or shorten

STEP 2 - Split if multi-topic:
A multi-topic entry contains two or more distinct subjects that would belong in different categories.

EXAMPLES of entries that MUST split:
- 'started lamictal 200mg today, also fought with mom' → split into health entry + relationships entry
- 'My brother is bipolar and he is 35 years old and lives in Australia' → split into 'My brother is bipolar' (relationships) + 'My brother is 35 years old and lives in Australia' (logistics) - because brother's mental health and brother's location are different facts deserving different categorization
- 'feeling anxious about NYU and I should email mom back' → emotional + relationships
- 'spent $200 at the dermatologist today, my skin is healing' → finance + health

EXAMPLES that should NOT split (single topic):
- 'started Abilify 2mg, sleeping better, slight irritation' (all about same med transition - one entry, health)
- 'Dan Bi and I had dinner at the new ramen place tonight' (one event - relationships)

STEP 3 - Categorize each entry. Use exactly ONE of these 7 categories (lowercase slug in JSON):
- health: medications, symptoms, body, sleep, exercise, clinical mental health treatment
- relationships: family, friends, partner, social interactions, conversations with people, facts ABOUT specific people in user's life
- career: work, jobs, applications, school, business operations
- logistics: scheduling, travel, dates, locations, biographical facts (birthday, age, address)
- finance: money, spending, costs, bills, investments
- emotional: feelings, mood, anxiety, joy in the moment; pattern-noticing and self-reflection about feelings also go here (formerly "reflection")
- other: ONLY when truly nothing fits

STEP 3b - ${TAG_EXTRACTION_BLOCK}

${thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive)}

After processing the entry, also generate a brief, natural acknowledgment message that confirms what you're saving. Keep it under 8 words. Examples:
- 'Saving Dan Bi's birthday'
- 'Logging your appointment'
- 'Got it, splitting into 2 entries'
- 'Noted'
- 'Saving 3 medication entries'
Don't be overly chatty or use exclamation marks. Just a calm confirmation.

Return ONLY valid JSON, no markdown:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "health|relationships|career|logistics|finance|emotional|other", "tags": ["Tag One", "Tag Two"]}]}`;
}

function buildManualSystemPrompt(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
  fixedCategory: KnownCategory,
): string {
  return `You are processing a single journal entry for a personal memory app.

The user chose category "${fixedCategory}" for this entry. Output exactly ONE entry with that category (do not split into multiple entries).

STEP 1 - Clean the text:
- Fix typos and spelling errors
- Remove duplicated/stuttered phrases
- Fix broken grammar
- Preserve the user's voice and meaning

STEP 2 - ${TAG_EXTRACTION_BLOCK}

${thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive)}

After processing, generate a brief acknowledgment under 8 words.

Return ONLY valid JSON, no markdown:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "${fixedCategory}", "tags": ["Tag One"]}]}`;
}

async function callAnthropicProcess(
  apiKey: string,
  system: string,
  userContent: string,
): Promise<{ ok: boolean; modelText: string }> {
  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1400,
      temperature: 0,
      system,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!anthropicResponse.ok) {
    return { ok: false, modelText: "" };
  }

  const rawResponseText = await anthropicResponse.text();
  let parsedApiResponse: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsedApiResponse = JSON.parse(rawResponseText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
  } catch (error) {
    console.error(
      "[process] Anthropic response body is not valid JSON:",
      error instanceof Error ? error.message : error,
      "snippet:",
      rawResponseText.slice(0, 500),
    );
    return { ok: false, modelText: "" };
  }

  const modelText =
    parsedApiResponse.content?.find((block) => block.type === "text")?.text ?? "";
  return { ok: true, modelText };
}

function normalizeModelEntries(parsedModelJson: {
  acknowledgment?: string;
  entries?: Array<{ text?: string; category?: string; tags?: unknown }>;
} | null): {
  acknowledgment: string;
  entries: ProcessedEntry[];
} | null {
  if (!parsedModelJson?.entries || !Array.isArray(parsedModelJson.entries)) {
    return null;
  }

  const cleanedEntries = parsedModelJson.entries
    .map((entry) => ({
      text: entry.text?.trim() ?? "",
      category: sanitizeCategory(entry.category),
      tags: normalizeTagList(entry.tags),
    }))
    .filter((entry) => entry.text.length > 0);

  if (cleanedEntries.length === 0) {
    return null;
  }

  const acknowledgmentRaw = parsedModelJson.acknowledgment;
  const acknowledgment =
    typeof acknowledgmentRaw === "string" && acknowledgmentRaw.trim().length > 0
      ? acknowledgmentRaw.trim().slice(0, 120)
      : "Noted";

  return { acknowledgment, entries: cleanedEntries };
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedSupabase();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userName = processingDisplayName(auth.user);
  const pronounsLine = pronounsLabelFromUser(auth.user);
  const examplePossessive = possessiveExample(userName);

  let originalText = "";

  try {
    const body = (await request.json()) as { text?: string; manualCategory?: string };
    originalText = body?.text?.trim() ?? "";
    const manualCategory = body?.manualCategory?.trim().toLowerCase();

    if (!originalText) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    const isManual = Boolean(manualCategory && manualCategory !== "auto");

    if (isManual && manualCategory) {
      const category = sanitizeCategory(manualCategory);
      if (!apiKey) {
        return NextResponse.json({
          entries: [{ text: originalText, category, tags: [] }],
        });
      }

      const system = buildManualSystemPrompt(
        userName,
        pronounsLine,
        examplePossessive,
        category,
      );
      const { ok, modelText } = await callAnthropicProcess(apiKey, system, originalText);
      if (!ok) {
        return NextResponse.json({
          entries: [{ text: originalText, category, tags: [] }],
        });
      }

      const parsedModelJson = parseEntriesFromModelText(modelText);
      const normalized = normalizeModelEntries(parsedModelJson);
      if (!normalized) {
        return NextResponse.json({
          entries: [{ text: originalText, category, tags: [] }],
        });
      }

      const single = normalized.entries[0];
      return NextResponse.json({
        acknowledgment: normalized.acknowledgment,
        entries: [
          {
            text: single.text,
            category,
            tags: normalizeTagList(single.tags),
          },
        ],
      });
    }

    if (!apiKey) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const system = buildAutoSystemPrompt(userName, pronounsLine, examplePossessive);
    const { ok, modelText } = await callAnthropicProcess(apiKey, system, originalText);
    if (!ok) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const parsedModelJson = parseEntriesFromModelText(modelText);
    const normalized = normalizeModelEntries(parsedModelJson);
    if (!normalized) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    return NextResponse.json({
      acknowledgment: normalized.acknowledgment,
      entries: normalized.entries,
    });
  } catch (error) {
    console.error("[process] unexpected error:", error);
    return NextResponse.json(fallbackEntries(originalText));
  }
}
