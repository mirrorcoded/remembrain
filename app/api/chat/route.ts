import { generateAndSaveChatTitle } from "@/lib/chat-title";
import { getRelevantContext } from "@/lib/retrieval";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedSupabase();
    if (!auth.user || !auth.supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { thread_id?: string; message?: string };
    const threadId = body?.thread_id?.trim();
    const message = body?.message?.trim();

    if (!threadId || !message) {
      return NextResponse.json(
        { error: "thread_id and message are required." },
        { status: 400 },
      );
    }

    const { supabase, user } = auth;

    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select("id, title, user_id")
      .eq("id", threadId)
      .maybeSingle();

    if (threadError || !thread || thread.user_id !== user.id) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const { error: insertUserError } = await supabase.from("chat_messages").insert({
      thread_id: threadId,
      role: "user",
      content: message,
    });

    if (insertUserError) {
      console.error("[chat] insert user message:", insertUserError);
      return NextResponse.json({ error: "Could not save message." }, { status: 500 });
    }

    const { context } = await getRelevantContext(user.id, message, { supabase });

    const { data: historyRows, error: historyError } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (historyError) {
      return NextResponse.json({ error: "Could not load history." }, { status: 500 });
    }

    const historyChronological = [...(historyRows ?? [])].reverse();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    const entriesBlock =
      context.trim().length > 0
        ? context
        : "(No journal entries yet — tell the user they haven't added entries.)";

    const todayIsoDate = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are a memory assistant for the user. Answer based on their entries below.

Today's date (for age, "next birthday," and relative date math): ${todayIsoDate} (ISO calendar date).

Be willing to REASON about the data, not just look it up:
- Calculate dates: e.g. "I got off X 6.5 months ago from April 23, 2026" → infer when they started (approximately early October 2025).
- Compute ages: birthday + current date → age or age on next birthday when asked.
- Infer durations: start date + end date → length of time; or stated duration run backward from a known end date.
- Make reasonable estimates when exact data isn't available.
- Connect related entries: if one entry says something started in January and another says it ended in March, infer duration.

When the user asks about something not directly stated in their entries:
- First try to INFER from related entries with appropriate hedging ("based on your entries," "approximately," etc.).
- If reasoning produces an answer, give it: e.g. "Based on your entries, this would be approximately [answer]."
- Only say you don't see that in their entries when there's truly no related information to reason from.

For lunar calendar questions: do your best to estimate the Gregorian window but flag uncertainty—the exact date varies year to year; suggest verifying with a lunar calendar converter when precision matters.

If a calculation needs real-time data you don't have (live weather, today's exact price, precise lunar conversion for a specific year), acknowledge that limitation but still give your best general estimate when helpful.

Be helpful and reason actively. Don't treat the entries as a strict lookup table—the user's data is a starting point for thinking.

Be concise and conversational. Reference dates when relevant. Don't be overly formal.

USER'S ENTRIES:
${entriesBlock}`;

    const claudeMessages = historyChronological
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => ({
        role: row.role as "user" | "assistant",
        content: String(row.content ?? ""),
      }));

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        temperature: 0,
        system: systemPrompt,
        messages: claudeMessages,
      }),
    });

    const rawText = await anthropicResponse.text();

    if (!anthropicResponse.ok) {
      console.error("[chat] Anthropic error:", rawText.slice(0, 500));
      return NextResponse.json({ error: "Assistant request failed." }, { status: 500 });
    }

    let parsed: { content?: Array<{ type?: string; text?: string }> };
    try {
      parsed = JSON.parse(rawText) as { content?: Array<{ type?: string; text?: string }> };
    } catch {
      return NextResponse.json({ error: "Assistant response invalid." }, { status: 500 });
    }

    const assistantText =
      parsed.content?.find((block) => block.type === "text")?.text?.trim() ??
      "Something went wrong.";

    const { error: insertAssistantError } = await supabase.from("chat_messages").insert({
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
    });

    if (insertAssistantError) {
      console.error("[chat] insert assistant:", insertAssistantError);
      return NextResponse.json({ error: "Could not save reply." }, { status: 500 });
    }

    const now = new Date().toISOString();
    await supabase.from("chat_threads").update({ updated_at: now }).eq("id", threadId);

    const needsTitle = thread.title == null || String(thread.title).trim() === "";
    if (needsTitle) {
      void generateAndSaveChatTitle(supabase, threadId).catch((err) => {
        console.error("[chat] title generation:", err);
      });
    }

    return NextResponse.json({ response: assistantText, thread_id: threadId });
  } catch (error) {
    console.error("[chat] unexpected:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
