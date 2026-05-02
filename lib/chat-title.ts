import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sets a short title on a thread from the first user + first assistant messages.
 * Used by /api/chat (fire-and-forget) and /api/chat-title.
 */
export async function generateAndSaveChatTitle(
  supabase: SupabaseClient,
  threadId: string,
): Promise<{ title: string } | { error: string }> {
  const { data: thread, error: threadError } = await supabase
    .from("chat_threads")
    .select("id, title")
    .eq("id", threadId)
    .maybeSingle();

  if (threadError || !thread) {
    return { error: "Thread not found." };
  }

  if (thread.title != null && String(thread.title).trim().length > 0) {
    return { title: String(thread.title).trim() };
  }

  const { data: messages, error: msgError } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (msgError || !messages?.length) {
    return { error: "No messages yet." };
  }

  let firstUser = "";
  let firstAssistant = "";
  for (const m of messages) {
    if (m.role === "user" && !firstUser) {
      firstUser = String(m.content ?? "").trim();
    } else if (m.role === "assistant" && !firstAssistant) {
      firstAssistant = String(m.content ?? "").trim();
    }
    if (firstUser && firstAssistant) {
      break;
    }
  }

  if (!firstUser || !firstAssistant) {
    return { error: "Need at least one user and one assistant message." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "Server configuration error." };
  }

  const prompt = `Here is the start of a conversation:\n\nUser: ${firstUser}\n\nAssistant: ${firstAssistant}\n\nGenerate a brief 4-6 word title for this conversation. Return only the title, no quotes or punctuation.`;

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 80,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const rawText = await anthropicResponse.text();
  if (!anthropicResponse.ok) {
    return { error: "Could not generate title." };
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(rawText) as { content?: Array<{ type?: string; text?: string }> };
  } catch {
    return { error: "Could not generate title." };
  }

  let title =
    parsed.content?.find((block) => block.type === "text")?.text?.trim() ??
    "";

  title = title.replace(/^["']|["']$/g, "").replace(/[.!?]+$/g, "").trim();

  if (!title) {
    return { error: "Empty title." };
  }

  const { error: updateError } = await supabase
    .from("chat_threads")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", threadId);

  if (updateError) {
    return { error: updateError.message };
  }

  return { title };
}
