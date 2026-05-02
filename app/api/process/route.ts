import { getAuthenticatedSupabase } from "@/lib/supabase/server";
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

export async function POST(request: Request) {
  const auth = await getAuthenticatedSupabase();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let originalText = "";

  try {
    const body = (await request.json()) as { text?: string; manualCategory?: string };
    originalText = body?.text?.trim() ?? "";
    const manualCategory = body?.manualCategory?.trim().toLowerCase();

    if (manualCategory && manualCategory !== "auto") {
      return NextResponse.json({
        entries: [{ text: originalText, category: sanitizeCategory(manualCategory) }],
      });
    }

    if (!originalText) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(fallbackEntries(originalText));
    }

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
        system: `You are processing journal entries for a personal memory app. Process the input through three steps:

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

After processing the entry, also generate a brief, natural acknowledgment message that confirms what you're saving. Keep it under 8 words. Examples:
- 'Saving Dan Bi's birthday'
- 'Logging your appointment'
- 'Got it, splitting into 2 entries'
- 'Noted'
- 'Saving 3 medication entries'
Don't be overly chatty or use exclamation marks. Just a calm confirmation.

Return ONLY valid JSON, no markdown:
{"acknowledgment": "brief calm confirmation under 8 words", "entries": [{"text": "cleaned text", "category": "category"}]}`,
        messages: [
          {
            role: "user",
            content: originalText,
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      return NextResponse.json(fallbackEntries(originalText));
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
      return NextResponse.json(fallbackEntries(originalText));
    }

    const modelText =
      parsedApiResponse.content?.find((block) => block.type === "text")?.text ?? "";

    const parsedModelJson = parseEntriesFromModelText(modelText);
    if (
      !parsedModelJson?.entries ||
      !Array.isArray(parsedModelJson.entries)
    ) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const cleanedEntries = parsedModelJson.entries
      .map((entry) => ({
        text: entry.text?.trim() ?? "",
        category: sanitizeCategory(entry.category),
      }))
      .filter((entry) => entry.text.length > 0);

    if (cleanedEntries.length === 0) {
      return NextResponse.json(fallbackEntries(originalText));
    }

    const acknowledgmentRaw = parsedModelJson.acknowledgment;
    const acknowledgment =
      typeof acknowledgmentRaw === "string" && acknowledgmentRaw.trim().length > 0
        ? acknowledgmentRaw.trim().slice(0, 120)
        : "Noted";

    return NextResponse.json({ acknowledgment, entries: cleanedEntries });
  } catch (error) {
    console.error("[process] unexpected error:", error);
    return NextResponse.json(fallbackEntries(originalText));
  }
}
