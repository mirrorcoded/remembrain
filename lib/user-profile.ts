import type { User } from "@supabase/supabase-js";

export type PronounsPreset = "he_him" | "she_her" | "they_them" | "custom";

/** Defaults when metadata has no pronouns saved yet (matches API default they/them). */
export function pronounsStateFromMetadata(meta: Record<string, unknown> | undefined): {
  preset: PronounsPreset;
  subject: string;
  object: string;
  possessive: string;
} {
  const preset = meta?.pronouns_preset;
  if (
    preset === "he_him" ||
    preset === "she_her" ||
    preset === "they_them" ||
    preset === "custom"
  ) {
    return {
      preset,
      subject: typeof meta?.pronouns_subject === "string" ? meta.pronouns_subject : "",
      object: typeof meta?.pronouns_object === "string" ? meta.pronouns_object : "",
      possessive:
        typeof meta?.pronouns_possessive === "string" ? meta.pronouns_possessive : "",
    };
  }
  return {
    preset: "they_them",
    subject: "",
    object: "",
    possessive: "",
  };
}

const PRESET_API_LABEL: Record<Exclude<PronounsPreset, "custom">, string> = {
  he_him: "he/him/his",
  she_her: "she/her/hers",
  they_them: "they/them/theirs",
};

/** First whitespace-delimited token of display name, or null if empty. */
export function firstTokenFromDisplayName(displayName: string): string | null {
  const t = displayName.trim();
  if (!t) {
    return null;
  }
  const first = t.split(/\s+/)[0];
  return first || null;
}

/** First name for greeting: display name token, else capitalized email local part. */
export function firstNameForGreeting(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const dn = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
  if (dn) {
    return firstTokenFromDisplayName(dn);
  }
  const email = user.email?.trim();
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (local) {
      return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
    }
  }
  return null;
}

/** Subtle header line: "Hi, Eric" or "Welcome". */
export function greetingLineForUser(user: User): string {
  const first = firstNameForGreeting(user);
  if (first) {
    return `Hi, ${first}`;
  }
  return "Welcome";
}

/** Raw profile display name (may be full Korean name, "Given Family", etc.). Used for Korean third-person rules. */
export function displayNameFromUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const dn = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
  return dn;
}

/** Name used in third-person rewrite (first name from display, else email local part, else fallback). */
export function processingDisplayName(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const dn = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
  if (dn) {
    const first = firstTokenFromDisplayName(dn);
    if (first) {
      return first;
    }
  }
  const email = user.email?.trim();
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (local) {
      return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
    }
  }
  return "User";
}

/** Readable pronoun set for the AI prompt (subject/object/possessive). */
export function pronounsLabelFromUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  return pronounsLabelFromMetadata(meta);
}

export function pronounsLabelFromMetadata(
  meta: Record<string, unknown> | undefined,
): string {
  const preset = meta?.pronouns_preset;
  if (preset === "custom") {
    const s = typeof meta?.pronouns_subject === "string" ? meta.pronouns_subject.trim() : "";
    const o = typeof meta?.pronouns_object === "string" ? meta.pronouns_object.trim() : "";
    const p =
      typeof meta?.pronouns_possessive === "string" ? meta.pronouns_possessive.trim() : "";
    if (s && o && p) {
      return `${s}/${o}/${p}`;
    }
  }
  if (preset === "he_him" || preset === "she_her" || preset === "they_them") {
    return PRESET_API_LABEL[preset];
  }
  return PRESET_API_LABEL.they_them;
}

export function possessiveExample(name: string): string {
  const n = name.trim();
  if (!n) {
    return "User's";
  }
  const lower = n.toLowerCase();
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("z")) {
    return `${n}'`;
  }
  return `${n}'s`;
}
