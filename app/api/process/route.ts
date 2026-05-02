import {
  normalizeTagList,
  sanitizeCategoryForStorage,
  type KnownCategory,
} from "@/lib/categories";
import { normalizeUserLocale, type UiLocale } from "@/lib/i18n";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  possessiveExample,
  processingDisplayName,
  pronounsLabelFromUser,
} from "@/lib/user-profile";
import { NextResponse } from "next/server";

function debugProcess(...args: unknown[]) {
  if (process.env.NODE_ENV === "development" || process.env.REMEMBRAIN_DEBUG_PROCESS === "1") {
    console.log("[process]", ...args);
  }
}

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
    const parsed = JSON.parse(trimmed) as {
      acknowledgment?: string;
      entries?: Array<{ text?: string; category?: string; tags?: unknown }>;
    };
    debugProcess(
      "Parsed JSON entries (raw tags field per row):",
      parsed.entries?.map((e, i) => ({
        index: i,
        tags: e.tags,
        tagsType: e.tags === undefined ? "missing" : typeof e.tags,
      })),
    );
    return parsed;
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

function koreanThirdPersonInstructionBlock(userName: string): string {
  return `STEP 4 - Third person (Korean):

If the user's language preference is Korean or the entry is primarily in Korean, follow Korean grammatical conventions. Korean often drops the subject when implied. Convert first-person to third-person by:
- Replacing 나/저/내/제 (I/me/my) with the user's name (${userName}) when the subject would otherwise be unclear or when the entry mentions the user as part of an action
- Don't force unnecessary subject pronouns — Korean reads more naturally without them
- Maintain the user's verb endings and politeness level
- Examples: '나는 댄비랑 하이킹했어' → '${userName}은 댄비랑 하이킹했어' or just '댄비와 하이킹함'
- '내 생일은 5월 19일이야' → '${userName}의 생일은 5월 19일'

For entries clearly not in Korean, apply the English third-person rules from the standard block mentally, but OUTPUT text in the entry's language.

USER NAME FOR REFERENCE: ${userName}`;
}

const TAG_EXTRACTION_BLOCK = `TAGS — Generate 1–5 relevant tags for EACH entry (after STEP 4 third-person text is final).

Tags should be:
- Specific names of people mentioned (e.g. Dan Bi, mom, Eric's brother) — use Title Case for proper names (Dan Bi not danbi).
- Specific things or topics (e.g. Abilify, NYU, biking, anniversary) — use lowercase for general topics (biking not Biking).
- Match the user's wording when they use a relationship word: if they wrote "mom", tag "mom" not "Mother".
- Skip tagging only when the entry is too short or too generic to justify tags; otherwise include names and concrete topics.

The "tags" field MUST be a JSON array of strings on every entry object — never omit it, never use a single string instead of an array.

Example shape:
{"entries":[{"text":"...","category":"relationships","tags":["Dan Bi","mom","hiking"]}]}`;

const TAG_EXTRACTION_BLOCK_KO = `TAGS — Generate 1–5 relevant tags for EACH entry (after STEP 4 third-person text is final).

Tags must be in the same language as the entry text after processing: use Korean tags for Korean entries and English tags for English entries.
- People and topics: use natural Korean wording (e.g. 댄비, 엄마, 하이킹) when the entry is Korean.
- Use concise noun phrases; match the user's wording when they use a relationship word.
- The "tags" field MUST be a JSON array of strings on every entry object — never omit it, never use a single string instead of an array.

Example (Korean entry):
{"entries":[{"text":"...","category":"relationships","tags":["댄비","하이킹"]}]}`;

function buildAutoSystemPrompt(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
  uiLocale: UiLocale,
): string {
  const thirdBlock =
    uiLocale === "ko"
      ? koreanThirdPersonInstructionBlock(userName)
      : thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive);
  const tagBlock = uiLocale === "ko" ? TAG_EXTRACTION_BLOCK_KO : TAG_EXTRACTION_BLOCK;
  const ackLang =
    uiLocale === "ko"
      ? "Write the acknowledgment in natural Korean (calm, under 8 words) when the content is Korean; English is fine for clearly English-only input."
      : "Write the acknowledgment in English.";

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

STEP 3b - ${tagBlock}

${thirdBlock}

After processing the entry, also generate a brief, natural acknowledgment message that confirms what you're saving. Keep it under 8 words. ${ackLang}
Examples:
- 'Saving Dan Bi's birthday'
- 'Logging your appointment'
- 'Got it, splitting into 2 entries'
- 'Noted'
- 'Saving 3 medication entries'
Don't be overly chatty or use exclamation marks. Just a calm confirmation.

Return ONLY valid JSON, no markdown fences:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "relationships", "tags": ["Dan Bi", "biking"]}]}`;
}

function buildManualSystemPrompt(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
  fixedCategory: KnownCategory,
  uiLocale: UiLocale,
): string {
  const thirdBlock =
    uiLocale === "ko"
      ? koreanThirdPersonInstructionBlock(userName)
      : thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive);
  const tagBlock = uiLocale === "ko" ? TAG_EXTRACTION_BLOCK_KO : TAG_EXTRACTION_BLOCK;

  return `You are processing a single journal entry for a personal memory app.

The user chose category "${fixedCategory}" for this entry. Output exactly ONE entry with that category (do not split into multiple entries).

STEP 1 - Clean the text:
- Fix typos and spelling errors
- Remove duplicated/stuttered phrases
- Fix broken grammar
- Preserve the user's voice and meaning

STEP 2 - ${tagBlock}

${thirdBlock}

After processing, generate a brief acknowledgment under 8 words.

Return ONLY valid JSON, no markdown fences:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "${fixedCategory}", "tags": ["Dan Bi", "biking"]}]}`;
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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
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
  debugProcess("Claude assistant message text length:", modelText.length);
  debugProcess("Claude raw output (first 2000 chars):\n", modelText.slice(0, 2000));
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
    .map((entry, idx) => {
      let tags: string[] = [];
      try {
        tags = normalizeTagList(entry.tags);
      } catch (tagErr) {
        console.error(
          "[process] tag normalization failed for entry index",
          idx,
          tagErr instanceof Error ? tagErr.message : tagErr,
        );
        tags = [];
      }
      return {
        text: entry.text?.trim() ?? "",
        category: sanitizeCategory(entry.category),
        tags,
      };
    })
    .filter((entry) => entry.text.length > 0);

  debugProcess(
    "Normalized entries after sanitize + normalizeTagList:",
    cleanedEntries.map((e) => ({ category: e.category, tags: e.tags })),
  );

  if (cleanedEntries.length === 0) {
    return null;
  }

  const allTagsEmpty = cleanedEntries.every((e) => e.tags.length === 0);
  if (allTagsEmpty) {
    console.warn(
      "[process] All entries have empty tags after parse — check Claude response or prompt.",
    );
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

  const uiLocale = normalizeUserLocale(auth.user.user_metadata?.ui_locale);

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
        uiLocale,
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
        debugProcess("Manual mode: normalizeModelEntries null, falling back");
        return NextResponse.json({
          entries: [{ text: originalText, category, tags: [] }],
        });
      }

      const single = normalized.entries[0];
      const tagsOut = normalizeTagList(single.tags);
      debugProcess("Manual mode single entry tags:", tagsOut);
      return NextResponse.json({
        acknowledgment: normalized.acknowledgment,
        entries: [
          {
            text: single.text,
            category,
            tags: tagsOut,
          },
        ],
      });
    }

    if (!apiKey) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const system = buildAutoSystemPrompt(userName, pronounsLine, examplePossessive, uiLocale);
    debugProcess("Auto mode, input length:", originalText.length);
    const { ok, modelText } = await callAnthropicProcess(apiKey, system, originalText);
    if (!ok) {
      debugProcess("Anthropic request failed or empty body");
      return NextResponse.json(fallbackEntries(originalText));
    }

    const parsedModelJson = parseEntriesFromModelText(modelText);
    const normalized = normalizeModelEntries(parsedModelJson);
    if (!normalized) {
      debugProcess("normalizeModelEntries returned null (parse failed or empty entries)");
      return NextResponse.json(fallbackEntries(originalText));
    }

    debugProcess("Response payload entries tags:", normalized.entries.map((e) => e.tags));
    return NextResponse.json({
      acknowledgment: normalized.acknowledgment,
      entries: normalized.entries,
    });
  } catch (error) {
    console.error("[process] unexpected error — returning fallback with empty tags:", error);
    return NextResponse.json(fallbackEntries(originalText));
  }
}
