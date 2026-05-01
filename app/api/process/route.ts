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
        system: `You are processing a journal entry from a personal memory app. Your job:

1. Fix obvious typos and grammatical errors. Be conservative - only fix clear mistakes. Preserve the user's voice, style, and word choice. Do NOT rewrite, paraphrase, or summarize.

2. Determine if the entry contains multiple distinct topics. A single entry typically discusses one event or thought. Multiple topics = unrelated subjects in the same text (e.g., medication AND relationship discussion).

3. If single topic: return one entry with the cleaned text and a category from: health, relationships, career, logistics, emotional, other.

4. If multiple distinct topics: split into separate entries, each with its own category. Each split entry should be a complete, standalone thought - don't fragment into single sentences if they belong together.

Return ONLY valid JSON in this exact format:
{
  "entries": [
    { "text": "cleaned text 1", "category": "category1" },
    { "text": "cleaned text 2", "category": "category2" }
  ]
}

No commentary, no explanation, just the JSON.`,
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
