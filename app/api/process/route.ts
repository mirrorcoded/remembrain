import { NextResponse } from "next/server";

const CATEGORIES = new Set([
  "health",
  "relationships",
  "career",
  "logistics",
  "emotional",
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

function fallbackEntries(originalText: string): { entries: ProcessedEntry[] } {
  return {
    entries: [
      {
        text: originalText,
        category: "other",
      },
    ],
  };
}

export async function POST(request: Request) {
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
        system: `You are processing a journal entry from a personal memory app. Follow these rules in order:

STEP 1 - Clean the text:
- Fix obvious typos and spelling errors
- Remove duplicate words and stuttered phrases (e.g., 'he is he is' becomes 'he is')
- Fix clearly broken grammar
- Preserve the user's voice, word choice, and meaning
- Do NOT paraphrase, summarize, or shorten substantively
- Do NOT change the user's vocabulary or style

STEP 2 - Detect multi-topic entries:
- A multi-topic entry contains TWO OR MORE distinct, unrelated subjects
- Examples that SHOULD split:
  * 'started lamictal 200mg today, also fought with mom' → 2 entries (health, relationships)
  * 'my brother is bipolar and lives in Australia' → 2 entries: 'my brother is bipolar' (relationships - it's about a family member's health, but the entry is about the brother), 'my brother lives in Australia' (logistics)
  * Actually wait - 'my brother is bipolar' is health context about a relationship. Categorize as 'relationships' since the subject is the brother.
- Examples that should NOT split (single topic):
  * 'started Abilify 2mg, sleeping better, slight irritation' (all about same med transition)
  * 'had a great talk with Dan Bi about NYU' (one conversation)

STEP 3 - Categorize each entry:
Categories and when to use them:
- health: medications, symptoms, doctor visits, body, sleep, diet, exercise, mental health
- relationships: family, friends, romantic partner, social interactions, conflicts, conversations with people
- career: work, jobs, applications, professional development, business, school
- logistics: scheduling, travel, addresses, dates, locations, plans, biographical facts (birthday, age)
- emotional: feelings, mood, internal experiences, anxiety, processing, reflection
- other: ONLY when truly nothing else fits

Be aggressive about picking specific categories. 'I am 32 years old' is logistics (biographical fact). 'My birthday is May 19' is logistics. Don't reach for 'other' just because something is brief.

Return ONLY valid JSON:
{
  "entries": [
    { "text": "cleaned text", "category": "category_name" }
  ]
}

No markdown, no commentary, just the JSON object.`,
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
    const parsedApiResponse = JSON.parse(rawResponseText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const modelText =
      parsedApiResponse.content?.find((block) => block.type === "text")?.text ?? "";

    const parsedModelJson = JSON.parse(modelText) as {
      entries?: Array<{ text?: string; category?: string }>;
    };

    if (!parsedModelJson.entries || !Array.isArray(parsedModelJson.entries)) {
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

    return NextResponse.json({ entries: cleanedEntries });
  } catch {
    return NextResponse.json(fallbackEntries(originalText));
  }
}
