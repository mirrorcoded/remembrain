import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const ENTRY_LIMIT = 50;
const MODEL = "claude-haiku-4-5-20251001";

function parseQuestionsFromModelText(modelText: string): string[] | null {
  let trimmed = modelText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/m);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const strings = parsed
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 3);
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

export async function POST() {
  const auth = await getAuthenticatedSupabase();
  if (!auth.user || !auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { supabase } = auth;

  const { data: rows, error } = await supabase
    .from("entries")
    .select("text, category, created_at")
    .order("created_at", { ascending: false })
    .limit(ENTRY_LIMIT);

  if (error) {
    console.error("[suggested-questions] entries:", error);
    return NextResponse.json({ error: "Could not load entries." }, { status: 500 });
  }

  const entries = rows ?? [];
  if (entries.length === 0) {
    return NextResponse.json({ questions: [] as string[] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const formattedEntries = entries
    .map((row, index) => {
      const text = typeof row.text === "string" ? row.text.trim() : "";
      const cat = typeof row.category === "string" ? row.category : "other";
      const created =
        typeof row.created_at === "string"
          ? row.created_at.slice(0, 10)
          : "";
      return `[${index + 1}] (${cat}${created ? `, ${created}` : ""}) ${text}`;
    })
    .join("\n\n");

  const userPrompt = `Based on these journal entries, suggest 3 short, useful questions the user might want to ask their personal memory app. Questions should be:
- Specific to topics actually present in their entries
- Useful for retrieval (asking about facts, dates, patterns)
- Brief (under 10 words each)
- Varied (don't ask 3 questions about the same topic)

Return ONLY a JSON array of 3 strings, no other text:
["question 1", "question 2", "question 3"]

ENTRIES:
${formattedEntries}`;

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      console.error("[suggested-questions] Anthropic HTTP:", anthropicResponse.status);
      return NextResponse.json({ questions: [] as string[] }, { status: 200 });
    }

    const raw = await anthropicResponse.text();
    let parsedResponse: { content?: Array<{ type?: string; text?: string }> };
    try {
      parsedResponse = JSON.parse(raw) as {
        content?: Array<{ type?: string; text?: string }>;
      };
    } catch {
      console.error("[suggested-questions] invalid JSON body:", raw.slice(0, 400));
      return NextResponse.json({ questions: [] as string[] });
    }

    const modelText =
      parsedResponse.content?.find((b) => b.type === "text")?.text ?? "";
    const questions = parseQuestionsFromModelText(modelText);

    if (!questions || questions.length === 0) {
      return NextResponse.json({ questions: [] as string[] });
    }

    return NextResponse.json({ questions });
  } catch (err) {
    console.error("[suggested-questions]", err);
    return NextResponse.json({ questions: [] as string[] });
  }
}
