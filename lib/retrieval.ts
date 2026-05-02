import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CONTEXT_TOKENS = 80_000;
/** Rough tokens ≈ words × 1.3 (heuristic for logging and truncation). */
const TOKENS_PER_WORD = 1.3;

export type RetrievalOptions = {
  supabase: SupabaseClient;
};

function estimateTokens(text: string): number {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return Math.ceil(words * TOKENS_PER_WORD);
}

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

/**
 * Retrieves journal text for RAG. Today: full-context load from `entries`.
 * Later: swap internals for semantic search; keep this signature and return shape.
 */
export async function getRelevantContext(
  userId: string,
  question: string,
  options: RetrievalOptions,
): Promise<{ context: string; truncated: boolean; estimatedTokens: number }> {
  void userId;
  void question;

  const { supabase } = options;

  const { data: rows, error } = await supabase
    .from("entries")
    .select("id, text, category, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[retrieval] entries fetch failed:", error.message);
    return { context: "", truncated: false, estimatedTokens: 0 };
  }

  const nonEmpty = (rows ?? []).filter((row) => String(row.text ?? "").trim().length > 0);

  const lines = nonEmpty.map((row) => {
    const ts = formatEntryTimestamp(row.created_at as string);
    const cat = String(row.category ?? "other");
    const text = String(row.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return `[${ts}] (${cat}) ${text}`;
  });

  let truncated = false;
  let working = [...lines];

  let joined = working.join("\n");
  let estimated = estimateTokens(joined);

  while (estimated > MAX_CONTEXT_TOKENS && working.length > 1) {
    working.shift();
    truncated = true;
    joined = working.join("\n");
    estimated = estimateTokens(joined);
  }

  if (estimated > MAX_CONTEXT_TOKENS && working.length === 1) {
    truncated = true;
    let single = working[0] ?? "";
    while (estimateTokens(single) > MAX_CONTEXT_TOKENS && single.length > 100) {
      single = single.slice(Math.floor(single.length * 0.85));
    }
    working = [single];
    joined = working.join("\n");
    estimated = estimateTokens(joined);
  }

  console.log(
    `[retrieval] full-context: ${nonEmpty.length} entries, estimated ~${estimated} tokens (word×${TOKENS_PER_WORD}), truncated=${truncated}`,
  );

  return {
    context: joined,
    truncated,
    estimatedTokens: estimated,
  };
}
