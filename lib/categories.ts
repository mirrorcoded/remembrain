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

/** Accent dots — slightly brighter on pure black UI. */
const DOT_KNOWN: Record<KnownCategory, string> = {
  health: "bg-[#4ade80]",
  relationships: "bg-[#fb7185]",
  career: "bg-[#60a5fa]",
  logistics: "bg-[#94a3b8]",
  emotional: "bg-[#c084fc]",
  finance: "bg-[#fbbf24]",
  other: "bg-[#cbd5e1]",
};

const DOT_LEGACY = "bg-[#cbd5e1]";

/** Category stats bars: gray ramp readable on dark track. */
const BAR_KNOWN: Record<KnownCategory, string> = {
  health: "bg-[#6b6b6b]",
  relationships: "bg-[#737373]",
  career: "bg-[#808080]",
  logistics: "bg-[#8a8a8a]",
  emotional: "bg-[#949494]",
  finance: "bg-[#9ca3a3]",
  other: "bg-[#a3a3a3]",
};

const BAR_LEGACY = "bg-[#a8a8a8]";

export function categoryDotClass(category: string): string {
  const n = category.trim().toLowerCase();
  if (isKnownCategory(n)) {
    return DOT_KNOWN[n];
  }
  return DOT_LEGACY;
}

/** @deprecated Prefer CategoryBadge / CategoryFilterChip — neutral pill only. */
export function categoryBadgeClass(category: string): string {
  void category;
  return "bg-[#1f1f1f] text-[#a3a3a3] ring-1 ring-white/10";
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

/** If Postgres/Supabase stored or returned a serialized JSON array as text, split into real tags. */
function expandSerializedJsonTagStrings(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) {
      continue;
    }
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) {
          for (const x of parsed) {
            if (typeof x === "string" && x.trim()) {
              out.push(x.trim());
            }
          }
          continue;
        }
      } catch {
        // treat as literal tag text
      }
    }
    out.push(part);
  }
  return out;
}

export function normalizeTagList(raw: unknown, maxTags = 5): string[] {
  /** Whole column sometimes arrives as a single JSON-array string, e.g. '["Dan Bi"]'. */
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) {
      return [];
    }
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) {
          return normalizeTagList(parsed, maxTags);
        }
      } catch {
        // fall through to comma / single-tag handling
      }
    }
    const parts = t.includes(",")
      ? t.split(",").map((s) => s.trim()).filter(Boolean)
      : [t];
    return normalizeTagList(parts, maxTags);
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  /** Flatten accidental [["a","b"]] from JSON shape mismatches. */
  let flattened = raw
    .flat(Infinity)
    .filter((item): item is string => typeof item === "string");
  flattened = expandSerializedJsonTagStrings(flattened);
  const out: string[] = [];
  const seenLower = new Set<string>();
  for (const item of flattened) {
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

/**
 * Only true when PostgREST/Postgres indicates the `tags` column is absent from the schema.
 * Must NOT match unrelated errors whose message happens to contain "tags" or "does not exist"
 * — otherwise the client retries insert without `tags` and silently wipes tag data.
 */
export function isMissingTagsColumnError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) {
    return false;
  }
  const m = String(error.message ?? "").toLowerCase();
  const code = String(error.code ?? "");
  if (code === "42703") {
    return m.includes("tags");
  }
  if (m.includes("schema cache") && m.includes("tags")) {
    return true;
  }
  if (m.includes("could not find") && m.includes("tags")) {
    return true;
  }
  if (
    m.includes("column") &&
    m.includes("tags") &&
    (m.includes("does not exist") || m.includes("unknown"))
  ) {
    return true;
  }
  return false;
}
