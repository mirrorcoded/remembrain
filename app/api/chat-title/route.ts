import { generateAndSaveChatTitle } from "@/lib/chat-title";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedSupabase();
    if (!auth.user || !auth.supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { thread_id?: string };
    const threadId = body?.thread_id?.trim();
    if (!threadId) {
      return NextResponse.json({ error: "thread_id is required." }, { status: 400 });
    }

    const { supabase, user } = auth;

    const { data: thread } = await supabase
      .from("chat_threads")
      .select("user_id")
      .eq("id", threadId)
      .maybeSingle();

    if (!thread || thread.user_id !== user.id) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const result = await generateAndSaveChatTitle(supabase, threadId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ title: result.title });
  } catch (error) {
    console.error("[chat-title] unexpected:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
