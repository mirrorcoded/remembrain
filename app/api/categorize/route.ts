import { NextResponse } from "next/server";

const CATEGORIES = new Set([
  "health",
  "relationships",
  "career",
  "logistics",
  "emotional",
  "other",
]);

function sanitizeCategory(value: string | undefined): string {
  if (!value) {
    return "other";
  }

  const normalizedValue = value.trim().toLowerCase();
  return CATEGORIES.has(normalizedValue) ? normalizedValue : "other";
}

export async function POST(request: Request) {
  try {
    console.log("[categorize] step=begin");
    const body = (await request.json()) as { text?: string };
    const text = body?.text?.trim();
    console.log("[categorize] step=parse_body incoming_text:", text);

    if (!text) {
      console.log("[categorize] step=validate_text empty default=other");
      return NextResponse.json({ category: "other" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const envKeysLikeAnthropic = Object.keys(process.env).filter((key) =>
      key.toLowerCase().includes("anthropic"),
    );
    console.log("[categorize] step=env_check anthropic_related_env_keys:", envKeysLikeAnthropic);
    console.log("[categorize] step=env_check api_key_present:", Boolean(apiKey));
    console.log("[categorize] step=env_check api_key_length:", apiKey?.length ?? 0);

    if (!apiKey) {
      console.log("[categorize] step=env_check missing_api_key default=other");
      return NextResponse.json({ category: "other" });
    }

    const payload = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `Categorize the journal entry into exactly one category from this list:
health, relationships, career, logistics, emotional, other.

Return ONLY the category name as a single lowercase word with no punctuation, explanation, or any other text.

Journal entry:
${text}`,
        },
      ],
    };
    console.log("[categorize] step=request anthropic_payload:", payload);

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const rawResponseText = await anthropicResponse.text();
    console.log("[categorize] step=response status:", anthropicResponse.status);
    console.log("[categorize] step=response raw_body:", rawResponseText);

    if (!anthropicResponse.ok) {
      console.log("[categorize] step=response non_ok default=other");
      return NextResponse.json({ category: "other" });
    }

    const response = JSON.parse(rawResponseText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    console.log("[categorize] step=parse_response parsed_json:", response);

    const textBlock = response.content?.find((block) => block.type === "text");
    const modelCategory = textBlock?.type === "text" ? textBlock.text : "other";
    console.log("[categorize] step=parse_response parsed_category:", modelCategory);

    return NextResponse.json({ category: sanitizeCategory(modelCategory) });
  } catch (error) {
    console.error("[categorize] step=error:", error);
    return NextResponse.json({ category: "other" });
  }
}
