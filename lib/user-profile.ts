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

const HANGUL_RUN = /^[가-힣]+$/;

/**
 * Given name for Korean third-person journal rewrite (스토어드 display_name 기준).
 * Heuristics: "김 단비" → 단비; three-syllable 한글 한 덩어리 "김단비" → 단비 (첫 글자 성 제거);
 * 서양식 "Eric Bae" → Eric; given만 "단비"(2글자) → 그대로 단비.
 */
export function derivedGivenNameForThirdPerson(displayNameFull: string): string {
  const raw = displayNameFull.trim();
  if (!raw) {
    return "";
  }

  const parts = raw.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const first = parts[0]!;
    const restJoined = parts.slice(1).join("");
    if (
      HANGUL_RUN.test(first) &&
      first.length === 1 &&
      restJoined.length > 0 &&
      HANGUL_RUN.test(restJoined)
    ) {
      return restJoined;
    }
    if (!HANGUL_RUN.test(first)) {
      return first;
    }
    return restJoined || first;
  }

  const single = parts[0] ?? raw;
  if (HANGUL_RUN.test(single) && single.length >= 3) {
    return single.slice(1);
  }

  return single;
}

/** Whether the last Hangul syllable has 받침 (affects 이/은 vs 가/는 등). Non-Hangul → false (treat like vowel-ending). */
export function hangulGivenNameEndsWithBatchim(givenName: string): boolean {
  const last = givenName[givenName.length - 1];
  if (!last) {
    return false;
  }
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return false;
  }
  return (code - 0xac00) % 28 !== 0;
}

/** Typical topic/topic-marked subject form for third-person state sentences (e.g. 단비는, 수범이는). */
export function koreanTopicParticlePhrase(givenName: string): string {
  const g = givenName.trim();
  if (!g) {
    return "";
  }
  return hangulGivenNameEndsWithBatchim(g) ? `${g}이는` : `${g}는`;
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
