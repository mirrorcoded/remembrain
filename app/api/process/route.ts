import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  possessiveExample,
  processingDisplayName,
  pronounsLabelFromUser,
} from "@/lib/user-profile";
import { NextResponse } from "next/server";

const CATEGORIES = new Set([
  "health",
  "relationships",
  "career",
  "logistics",
  "emotional",
  "finance",
  "ideas",
  "learning",
  "reflection",
  "other",
]);

type ProcessedEntry = {
  text: string;
  category: string;
};

function sanitizeCategory(value: string | undefined): string {
  if (!value) {
    return "other";
  }

  const normalizedValue = value.trim().toLowerCase();
  return CATEGORIES.has(normalizedValue) ? normalizedValue : "other";
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
      },
    ],
  };
}

/** Strip markdown fences and parse Claude's entries JSON; returns null on failure. */
function parseEntriesFromModelText(modelText: string): {
  acknowledgment?: string;
  entries?: Array<{ text?: string; category?: string }>;
} | null {
  let trimmed = modelText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/m);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(trimmed) as {
      acknowledgment?: string;
      entries?: Array<{ text?: string; category?: string }>;
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
  return `STEP 4 - Third person (apply to each entry's text after steps 1–3):
After processing the entry (cleaning typos, splitting if multi-topic, categorizing), rewrite the text to use third person with the user's name and pronouns instead of first-person.

USER NAME: ${userName}
USER PRONOUNS: ${pronounsLine}

Examples (using this user's name; adjust possessives and pronouns to match USER PRONOUNS):
- 'My birthday is May 19' becomes '${examplePossessive} birthday is May 19'
- 'I love Dan Bi' becomes '${userName} loves Dan Bi'
- 'I am glad my wife is Dan Bi' becomes '${userName} is glad his wife is Dan Bi' (when using he/him) or the equivalent with the user's pronouns
- 'Dan Bi and I went to dinner' becomes 'Dan Bi and ${userName} went to dinner' (or '${userName} and Dan Bi went to dinner') without duplicating the name if the user already used it in the entry

Rules:
- Replace I/me/my/mine and similar first-person with the user's name and appropriate pronouns from USER PRONOUNS
- Adjust verb conjugation accordingly (I am → ${userName} is, I have → ${userName} has)
- Do not change quoted speech or things other people said
- If the user already uses their name in the entry (e.g. 'Eric and Dan Bi went to dinner'), do not repeat or double the name unnaturally
- Preserve the user's voice in word choice and meaning—only shift perspective
- Do not add information that was not in the original
- If the text has no first-person language, keep it as-is (aside from light cleanup from step 1 if any)`;
}

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

STEP 3 - Categorize each entry. Use these 10 categories:
- health: medications, symptoms, body, sleep, exercise, mental health
- relationships: family, friends, partner, social interactions, conversations with people, facts ABOUT specific people in user's life
- career: work, jobs, applications, school, business operations
- logistics: scheduling, travel, dates, locations, biographical facts (birthday, age, address)
- emotional: in-the-moment feelings, mood
- finance: money, spending, costs, bills, investments
- ideas: product/business ideas, creative thoughts, things to build
- learning: things read/watched/learned, skills being acquired
- reflection: pattern-noticing about oneself, self-observations, meta-cognitive insights
- other: ONLY when truly nothing fits

${thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive)}

After processing the entry, also generate a brief, natural acknowledgment message that confirms what you're saving. Keep it under 8 words. Examples:
- 'Saving Dan Bi's birthday'
- 'Logging your appointment'
- 'Got it, splitting into 2 entries'
- 'Noted'
- 'Saving 3 medication entries'
Don't be overly chatty or use exclamation marks. Just a calm confirmation.

Return ONLY valid JSON, no markdown:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "category"}]}`;
}

function buildManualSystemPrompt(
  userName: string,
  pronounsLine: string,
  examplePossessive: string,
  fixedCategory: string,
): string {
  return `You are processing a single journal entry for a personal memory app.

The user chose category "${fixedCategory}" for this entry. Output exactly ONE entry with that category (do not split into multiple entries).

STEP 1 - Clean the text:
- Fix typos and spelling errors
- Remove duplicated/stuttered phrases
- Fix broken grammar
- Preserve the user's voice and meaning

${thirdPersonInstructionBlock(userName, pronounsLine, examplePossessive)}

After processing, generate a brief acknowledgment under 8 words.

Return ONLY valid JSON, no markdown:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned and third-person text", "category": "${fixedCategory}"}]}`;
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
      max_tokens: 1200,
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
  entries?: Array<{ text?: string; category?: string }>;
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

    const isManual =
      Boolean(manualCategory && manualCategory !== "auto");

    if (isManual && manualCategory) {
      const category = sanitizeCategory(manualCategory);
      if (!apiKey) {
        return NextResponse.json({
          entries: [{ text: originalText, category }],
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
          entries: [{ text: originalText, category }],
        });
      }

      const parsedModelJson = parseEntriesFromModelText(modelText);
      const normalized = normalizeModelEntries(parsedModelJson);
      if (!normalized) {
        return NextResponse.json({
          entries: [{ text: originalText, category }],
        });
      }

      const single = normalized.entries[0];
      return NextResponse.json({
        acknowledgment: normalized.acknowledgment,
        entries: [{ text: single.text, category }],
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
