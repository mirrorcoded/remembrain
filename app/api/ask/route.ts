import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function formatEntryTimestamp(iso: string): string {
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

  return `${datePart} at ${timePart}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = body?.question?.trim();
    if (!question) {
      return NextResponse.json({ answer: "Please enter a question." });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return NextResponse.json({ answer: "Server configuration error." }, { status: 500 });
    }

    const supabase = createClient(url, key);
    const { data: rows, error } = await supabase
      .from("entries")
      .select("id, text, category, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { answer: "Could not load your entries. Try again." },
        { status: 500 },
      );
    }

    if (!rows?.length) {
      return NextResponse.json({
        answer: "I don't have that in your entries—you haven't added any journal entries yet.",
      });
    }

    const entriesBlock = rows
      .map((row) => {
        const ts = formatEntryTimestamp(row.created_at as string);
        const cat = String(row.category ?? "other");
        const text = String(row.text ?? "").replace(/\s+/g, " ").trim();
        return `[${ts}] (${cat}) ${text}`;
      })
      .join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ answer: "Server configuration error." }, { status: 500 });
    }

    const systemPrompt = `You are a memory assistant for the user. You have access to their personal journal entries below. Answer their questions accurately based ONLY on what's in their entries. If the answer isn't in the entries, say 'I don't have that in your entries' rather than guessing. Be concise. Reference specific entries when relevant by mentioning the date.

The user's entries:
${entriesBlock}`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });

    const rawText = await anthropicResponse.text();

    if (!anthropicResponse.ok) {
      return NextResponse.json({ answer: "Something went wrong. Please try again." }, { status: 500 });
    }

    let parsed: { content?: Array<{ type?: string; text?: string }> };
    try {
      parsed = JSON.parse(rawText) as { content?: Array<{ type?: string; text?: string }> };
    } catch {
      return NextResponse.json({ answer: "Something went wrong. Please try again." }, { status: 500 });
    }

    const answer =
      parsed.content?.find((block) => block.type === "text")?.text?.trim() ??
      "Something went wrong.";

    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ answer: "Something went wrong. Please try again." }, { status: 500 });
  }
}
