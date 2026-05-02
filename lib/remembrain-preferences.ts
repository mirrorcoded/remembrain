import type { KnownCategory } from "@/lib/categories";
import { KNOWN_CATEGORIES } from "@/lib/categories";

/** Matches journal category union on the home page. */
export type DefaultCategoryPreference = "auto" | KnownCategory;

export const PREF_DEFAULT_CATEGORY_KEY = "remembrain_default_category";
export const PREF_STATS_EXPANDED_KEY = "remembrain_stats_expanded";
export const LAST_BACKUP_STORAGE_KEY = "remembrain_last_backup";
export const BACKUP_BANNER_SNOOZE_UNTIL_KEY = "remembrain_backup_banner_snooze_until";

const CATEGORIES = new Set<string>(KNOWN_CATEGORIES);

function sanitizeCategoryPref(raw: string | null): DefaultCategoryPreference {
  if (!raw || raw === "auto") {
    return "auto";
  }
  const n = raw.trim().toLowerCase();
  return CATEGORIES.has(n) ? (n as Exclude<DefaultCategoryPreference, "auto">) : "auto";
}

export function readDefaultCategoryPreference(): DefaultCategoryPreference {
  try {
    return sanitizeCategoryPref(localStorage.getItem(PREF_DEFAULT_CATEGORY_KEY));
  } catch {
    return "auto";
  }
}

export function writeDefaultCategoryPreference(value: DefaultCategoryPreference): void {
  try {
    localStorage.setItem(PREF_DEFAULT_CATEGORY_KEY, value);
  } catch {
    // ignore
  }
}

/** When true, Entries tab stats panel starts expanded on load. Default collapsed when unset. */
export function readStatsExpandedPreference(): boolean {
  try {
    const raw = localStorage.getItem(PREF_STATS_EXPANDED_KEY);
    if (raw === null) {
      return false;
    }
    return raw === "true";
  } catch {
    return false;
  }
}

export function writeStatsExpandedPreference(expanded: boolean): void {
  try {
    localStorage.setItem(PREF_STATS_EXPANDED_KEY, expanded ? "true" : "false");
  } catch {
    // ignore
  }
}

export function formatBackupCalendarLabel(iso: string, intlLocale = "en-US"): string {
  return new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
