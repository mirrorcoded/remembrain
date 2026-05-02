/** Manual journal categories (AI uses the same set). Order matches UI. */
export const KNOWN_CATEGORIES = [
  "health",
  "relationships",
  "career",
  "logistics",
  "finance",
  "emotional",
  "other",
] as const;

export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

const KNOWN_SET = new Set<string>(KNOWN_CATEGORIES);

export function isKnownCategory(value: string): value is KnownCategory {
  return KNOWN_SET.has(value);
}

/** Normalize API / form output to a stored category (unknown → other). */
export function sanitizeCategoryForStorage(value: string | undefined): KnownCategory {
  if (!value) {
    return "other";
  }
  const n = value.trim().toLowerCase();
  return KNOWN_SET.has(n) ? (n as KnownCategory) : "other";
}

/** Display labels for known categories only. */
export const CATEGORY_LABELS: Record<KnownCategory, string> = {
  health: "Health",
  relationships: "Relationships",
  career: "Career",
  logistics: "Logistics",
  finance: "Finance",
  emotional: "Emotional",
  other: "Other",
};

/** Legacy DB values no longer selectable — show gray badge with readable label. */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  ideas: "Ideas",
  learning: "Learning",
  reflection: "Reflection",
};

export function categoryDisplayLabel(raw: string): string {
  const n = raw.trim().toLowerCase();
  if (isKnownCategory(n)) {
    return CATEGORY_LABELS[n];
  }
  return LEGACY_CATEGORY_LABELS[n] ?? (raw.trim() || "Other");
}

const BADGE_KNOWN: Record<KnownCategory, string> = {
  health:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  relationships:
    "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  career:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  logistics:
    "bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  emotional:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  finance:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  other: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

const BADGE_LEGACY =
  "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

const BAR_KNOWN: Record<KnownCategory, string> = {
  health: "bg-emerald-500 dark:bg-emerald-400",
  relationships: "bg-pink-500 dark:bg-pink-400",
  career: "bg-blue-500 dark:bg-blue-400",
  logistics: "bg-zinc-500 dark:bg-zinc-400",
  emotional: "bg-violet-500 dark:bg-violet-400",
  finance: "bg-amber-500 dark:bg-amber-400",
  other: "bg-zinc-400 dark:bg-zinc-500",
};

const BAR_LEGACY = "bg-zinc-400 dark:bg-zinc-500";

export function categoryBadgeClass(category: string): string {
  const n = category.trim().toLowerCase();
  if (isKnownCategory(n)) {
    return BADGE_KNOWN[n];
  }
  return BADGE_LEGACY;
}

export function categoryBarFillClass(category: string): string {
  const n = category.trim().toLowerCase();
  if (isKnownCategory(n)) {
    return BAR_KNOWN[n];
  }
  return BAR_LEGACY;
}

/** "Other" filter includes explicit other + any legacy/unknown category. */
/** Legacy slugs still stored for old rows until the user re-categorizes. */
const LEGACY_CATEGORY_SLUGS = new Set(["ideas", "learning", "reflection"]);

/** Normalize category when saving an edited entry (preserves legacy slugs). */
export function persistEntryCategory(raw: string): string {
  const n = raw.trim().toLowerCase();
  if (isKnownCategory(n)) {
    return n;
  }
  if (LEGACY_CATEGORY_SLUGS.has(n)) {
    return n;
  }
  return "other";
}

export function entryMatchesKnownCategoryFilter(
  entryCategory: string,
  filter: KnownCategory | "all",
): boolean {
  if (filter === "all") {
    return true;
  }
  const ec = entryCategory.trim().toLowerCase();
  if (filter === "other") {
    return ec === "other" || !isKnownCategory(ec);
  }
  return ec === filter;
}

export function normalizeTagList(raw: unknown, maxTags = 5): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seenLower = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const t = item.trim();
    if (!t) {
      continue;
    }
    const key = t.toLowerCase();
    if (seenLower.has(key)) {
      continue;
    }
    seenLower.add(key);
    out.push(t);
    if (out.length >= maxTags) {
      break;
    }
  }
  return out;
}

/** PostgREST / Postgres when `tags` column was never added — retry inserts/updates without `tags`. */
export function isMissingTagsColumnError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) {
    return false;
  }
  const m = String(error.message ?? "").toLowerCase();
  return (
    m.includes("tags") ||
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    error.code === "42703"
  );
}
