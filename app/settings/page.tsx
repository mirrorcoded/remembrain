"use client";

import { useI18n } from "@/components/I18nProvider";
import { supabase } from "@/lib/supabase";
import { isMissingTagsColumnError, normalizeTagList } from "@/lib/categories";
import { intlLocaleForUi, type UiLocale } from "@/lib/i18n";
import {
  formatBackupCalendarLabel,
  LAST_BACKUP_STORAGE_KEY,
  readDefaultCategoryPreference,
  readStatsExpandedPreference,
  writeDefaultCategoryPreference,
  writeStatsExpandedPreference,
  type DefaultCategoryPreference,
} from "@/lib/remembrain-preferences";
import {
  type PronounsPreset,
  pronounsStateFromMetadata,
} from "@/lib/user-profile";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const BACKUP_APP_VERSION = "1.1";

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[15px] text-white outline-none transition focus:border-white focus:ring-0";

const sectionClass =
  "space-y-4 rounded-2xl border border-[#1f1f1f] bg-[#0a0a0a] p-5 shadow-sm";

export default function SettingsPage() {
  const { t, locale, setUiLocale } = useI18n();
  const intlLoc = intlLocaleForUi(locale);

  const categoryPreferenceOptions = useMemo(
    (): { value: DefaultCategoryPreference; label: string }[] => [
      { value: "auto", label: t("common.auto") },
      { value: "health", label: t("category.health") },
      { value: "relationships", label: t("category.relationships") },
      { value: "career", label: t("category.career") },
      { value: "logistics", label: t("category.logistics") },
      { value: "finance", label: t("category.finance") },
      { value: "emotional", label: t("category.emotional") },
      { value: "other", label: t("category.other") },
    ],
    [t],
  );

  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pronounsPreset, setPronounsPreset] = useState<PronounsPreset>("they_them");
  const [pronounsSubject, setPronounsSubject] = useState("");
  const [pronounsObject, setPronounsObject] = useState("");
  const [pronounsPossessive, setPronounsPossessive] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const [entryCount, setEntryCount] = useState<number | null>(null);
  const [lastBackupIso, setLastBackupIso] = useState<string | null>(null);
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);

  const [defaultCategory, setDefaultCategory] = useState<DefaultCategoryPreference>("auto");
  const [statsExpandedDefault, setStatsExpandedDefault] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);

  const [tagsCatalog, setTagsCatalog] = useState<{ tag: string; count: number }[]>([]);
  const [tagsCatalogBusy, setTagsCatalogBusy] = useState(false);
  const [tagsCatalogError, setTagsCatalogError] = useState<string | null>(null);
  const [tagRenameBusy, setTagRenameBusy] = useState<string | null>(null);
  const [renameTargetTag, setRenameTargetTag] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [signOutBusy, setSignOutBusy] = useState(false);

  const refreshLocalBackupLabel = useCallback(() => {
    try {
      setLastBackupIso(localStorage.getItem(LAST_BACKUP_STORAGE_KEY));
    } catch {
      setLastBackupIso(null);
    }
  }, []);

  const refreshTagsCatalog = useCallback(async () => {
    setTagsCatalogBusy(true);
    setTagsCatalogError(null);
    try {
      const { data, error } = await supabase.from("entries").select("*");
      if (error) {
        setTagsCatalogError(t("common.settingsCouldNotLoadTags"));
        setTagsCatalog([]);
        return;
      }
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const raw = row.tags;
        if (!Array.isArray(raw)) {
          continue;
        }
        for (const tagStr of raw) {
          if (typeof tagStr !== "string") {
            continue;
          }
          const k = tagStr.trim();
          if (!k) {
            continue;
          }
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      const rows = [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      setTagsCatalog(rows);
    } finally {
      setTagsCatalogBusy(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (!session?.user) {
        router.replace("/");
        return;
      }
      setEmail(session.user.email ?? "");
      const meta = session.user.user_metadata as Record<string, unknown> | undefined;
      setDisplayName(typeof meta?.display_name === "string" ? meta.display_name : "");
      const ps = pronounsStateFromMetadata(meta);
      setPronounsPreset(ps.preset);
      setPronounsSubject(ps.subject);
      setPronounsObject(ps.object);
      setPronounsPossessive(ps.possessive);
      setReady(true);
      refreshLocalBackupLabel();
      setDefaultCategory(readDefaultCategoryPreference());
      setStatsExpandedDefault(readStatsExpandedPreference());

      const { count, error } = await supabase
        .from("entries")
        .select("*", { count: "exact", head: true });
      if (!cancelled && !error) {
        setEntryCount(count ?? 0);
      }
      if (!cancelled) {
        void refreshTagsCatalog();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, refreshLocalBackupLabel, refreshTagsCatalog]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    setProfileNotice(null);
    if (pronounsPreset === "custom") {
      const s = pronounsSubject.trim();
      const o = pronounsObject.trim();
      const p = pronounsPossessive.trim();
      if (!s || !o || !p) {
        setProfileError(t("common.authCustomPronounsRequired"));
        return;
      }
    }
    setProfileBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          display_name: displayName.trim() || undefined,
          pronouns_preset: pronounsPreset,
          pronouns_subject:
            pronounsPreset === "custom" ? pronounsSubject.trim() : undefined,
          pronouns_object:
            pronounsPreset === "custom" ? pronounsObject.trim() : undefined,
          pronouns_possessive:
            pronounsPreset === "custom" ? pronounsPossessive.trim() : undefined,
        },
      });
      if (error) {
        setProfileError(error.message);
        return;
      }
      setProfileNotice(t("settings.profileSaved"));
      setTimeout(() => setProfileNotice(null), 3000);
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t("common.settingsPasswordMismatch"));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t("common.settingsPasswordTooShort"));
      return;
    }
    if (!email) {
      setPasswordError(t("common.settingsNoEmail"));
      return;
    }
    setPasswordBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signErr) {
        setPasswordError(t("common.settingsWrongPassword"));
        return;
      }
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
      if (upErr) {
        setPasswordError(upErr.message);
        return;
      }
      setPasswordNotice(t("common.settingsPasswordUpdated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTimeout(() => setPasswordNotice(null), 3000);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDownloadBackup() {
    setBackupError(null);
    setBackupNotice(null);
    setBackupDownloading(true);
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        setBackupError(t("common.settingsBackupFailed"));
        setBackupDownloading(false);
        return;
      }

      type BackupRow = {
        id: number;
        created_at: string;
        text: string | null;
        category: string | null;
        tags: string[] | null;
        user_id: string | null;
      };

      const rows = (data ?? []) as BackupRow[];
      const exportDate = new Date().toISOString();
      const payload = {
        export_date: exportDate,
        app_version: BACKUP_APP_VERSION,
        entry_count: rows.length,
        entries: rows.map((row) => ({
          id: row.id,
          created_at: row.created_at,
          text: row.text ?? "",
          category: row.category ?? "other",
          tags: Array.isArray(row.tags) ? row.tags : [],
          user_id: row.user_id ?? null,
        })),
      };

      const json = JSON.stringify(payload, null, 2);
      const y = new Date().getFullYear();
      const m = String(new Date().getMonth() + 1).padStart(2, "0");
      const d = String(new Date().getDate()).padStart(2, "0");
      const filename = `remembrain-backup-${y}-${m}-${d}.json`;
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);

      try {
        localStorage.setItem(LAST_BACKUP_STORAGE_KEY, exportDate);
      } catch {
        // quota
      }
      refreshLocalBackupLabel();
      setBackupNotice(t("common.settingsBackupDownloaded"));
      setTimeout(() => setBackupNotice(null), 4000);
    } catch {
      setBackupError(t("common.settingsBackupFailed"));
    } finally {
      setBackupDownloading(false);
    }
  }

  async function handleDeleteAllEntries() {
    setDeleteAllError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDeleteAllError(t("common.settingsNotSignedIn"));
      return;
    }
    setDeleteAllBusy(true);
    try {
      const { error } = await supabase.from("entries").delete().eq("user_id", user.id);
      if (error) {
        setDeleteAllError(error.message);
        return;
      }
      setEntryCount(0);
      setDeleteAllOpen(false);
      setDeleteAllConfirmText("");
      setBackupNotice(t("common.settingsDeleteAllDone"));
      setTimeout(() => setBackupNotice(null), 4000);
      router.push("/");
      router.refresh();
    } finally {
      setDeleteAllBusy(false);
    }
  }

  function handleSavePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPrefsNotice(null);
    setPrefsBusy(true);
    try {
      writeDefaultCategoryPreference(defaultCategory);
      writeStatsExpandedPreference(statsExpandedDefault);
      setPrefsNotice(t("settings.prefsSaved"));
      setTimeout(() => setPrefsNotice(null), 3000);
    } finally {
      setPrefsBusy(false);
    }
  }

  async function handleRenameTagEverywhere(fromTag: string, toRaw: string) {
    const toTag = toRaw.trim();
    if (!toTag || fromTag === toTag) {
      return;
    }
    setTagRenameBusy(fromTag);
    setTagsCatalogError(null);
    try {
      const { data: rows, error } = await supabase.from("entries").select("*");
      if (error || !rows) {
        setTagsCatalogError(t("common.settingsCouldNotUpdateEntries"));
        return;
      }
      for (const row of rows) {
        const rawTags = (row as { id: number; tags?: unknown }).tags;
        const tags = Array.isArray(rawTags)
          ? rawTags.filter((item: unknown): item is string => typeof item === "string")
          : [];
        if (!tags.some((t) => t === fromTag)) {
          continue;
        }
        const next = normalizeTagList(tags.map((t) => (t === fromTag ? toTag : t)));
        const id = (row as { id: number }).id;
        const upErr = (
          await supabase
            .from("entries")
            .update({ tags: next })
            .eq("id", id)
        ).error;
        if (upErr && isMissingTagsColumnError(upErr)) {
          setTagsCatalogError(t("common.settingsTagsColumnMissingRename"));
          return;
        }
        if (upErr) {
          setTagsCatalogError(t("common.settingsRenameTagFailed"));
          return;
        }
      }
      await refreshTagsCatalog();
    } finally {
      setTagRenameBusy(null);
    }
  }

  async function handleDeleteTagEverywhere(tag: string) {
    const confirmed = window.confirm(t("common.settingsRemoveTagPrompt", { tag }));
    if (!confirmed) {
      return;
    }
    setTagRenameBusy(tag);
    setTagsCatalogError(null);
    try {
      const { data: rows, error } = await supabase.from("entries").select("*");
      if (error || !rows) {
        setTagsCatalogError(t("common.settingsCouldNotUpdateEntries"));
        return;
      }
      for (const row of rows) {
        const rawTags = (row as { id: number; tags?: unknown }).tags;
        const tags = Array.isArray(rawTags)
          ? rawTags.filter((item: unknown): item is string => typeof item === "string")
          : [];
        if (!tags.includes(tag)) {
          continue;
        }
        const next = normalizeTagList(tags.filter((t) => t !== tag));
        const id = (row as { id: number }).id;
        const upErr = (
          await supabase
            .from("entries")
            .update({ tags: next })
            .eq("id", id)
        ).error;
        if (upErr && isMissingTagsColumnError(upErr)) {
          setTagsCatalogError(t("common.settingsTagsColumnMissingRemove"));
          return;
        }
        if (upErr) {
          setTagsCatalogError(t("common.settingsRemoveTagFailed"));
          return;
        }
      }
      await refreshTagsCatalog();
    } finally {
      setTagRenameBusy(null);
    }
  }

  async function handleSignOut() {
    setSignOutBusy(true);
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("common.loading")}</p>
      </div>
    );
  }

  const n = entryCount ?? 0;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto flex w-full min-w-0 max-w-lg touch-pan-y flex-col gap-6 overflow-x-hidden px-4 py-8 sm:max-w-xl sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("common.settingsBack")}
          </Link>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("common.settingsSubtitle")}</p>
        </header>

        <section className={sectionClass} aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-base font-semibold">
            {t("common.settingsAccount")}
          </h2>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("common.email")}
            </p>
            <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{email || "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("common.settingsEmailRo")}</p>
          </div>

          <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-4">
            <label className="block text-sm font-medium">
              {t("common.settingsDisplayName")}
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                autoComplete="nickname"
                placeholder="Optional — e.g. Eric Bae"
              />
            </label>

            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="pronouns-preset">
                {t("common.settingsPronouns")}
              </label>
              <select
                id="pronouns-preset"
                value={pronounsPreset}
                onChange={(e) => setPronounsPreset(e.target.value as PronounsPreset)}
                className={inputClass}
              >
                <option value="he_him">He/him/his</option>
                <option value="she_her">She/her/hers</option>
                <option value="they_them">They/them/theirs</option>
                <option value="custom">Custom</option>
              </select>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("common.settingsPronounsHelp")}
              </p>
            </div>

            {pronounsPreset === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm font-medium">
                  {t("common.settingsSubject")}
                  <input
                    type="text"
                    value={pronounsSubject}
                    onChange={(e) => setPronounsSubject(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. they"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm font-medium">
                  {t("common.settingsObject")}
                  <input
                    type="text"
                    value={pronounsObject}
                    onChange={(e) => setPronounsObject(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. them"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm font-medium">
                  {t("common.settingsPossessive")}
                  <input
                    type="text"
                    value={pronounsPossessive}
                    onChange={(e) => setPronounsPossessive(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. their"
                    autoComplete="off"
                  />
                </label>
              </div>
            ) : null}

            {profileError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{profileError}</p>
            ) : null}
            {profileNotice ? (
              <p className="text-sm text-[#4a4a4a] dark:text-[#a3a3a3]">{profileNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={profileBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {profileBusy ? t("common.settingsSaveProfileBusy") : t("common.authSaveProfile")}
            </button>
          </form>

          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="text-sm font-medium">{t("settings.updatePassword")}</p>
            <label className="block text-sm font-medium">
              {t("common.authCurrentPassword")}
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                autoComplete="current-password"
              />
            </label>
            <label className="block text-sm font-medium">
              {t("common.authNewPassword")}
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
              />
            </label>
            <label className="block text-sm font-medium">
              {t("common.authConfirmNewPassword")}
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
              />
            </label>
            {passwordError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{passwordError}</p>
            ) : null}
            {passwordNotice ? (
              <p className="text-sm text-[#4a4a4a] dark:text-[#a3a3a3]">{passwordNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={passwordBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {passwordBusy ? t("settings.updatingPassword") : t("settings.updatePassword")}
            </button>
          </form>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signOutBusy}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-950"
            >
              {signOutBusy ? t("settings.signingOut") : t("settings.signOut")}
            </button>
          </div>
        </section>

        <section className={sectionClass} aria-labelledby="data-heading">
          <h2 id="data-heading" className="text-base font-semibold">
            {t("settings.dataManagement")}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("settings.totalEntriesLabel")}{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{entryCount ?? "—"}</span>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("settings.lastBackup")}{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {lastBackupIso ? formatBackupCalendarLabel(lastBackupIso, intlLoc) : t("settings.never")}
            </span>
          </p>
          {backupNotice ? (
            <p className="text-sm text-[#4a4a4a] dark:text-[#a3a3a3]">{backupNotice}</p>
          ) : null}
          {backupError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{backupError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleDownloadBackup()}
            disabled={backupDownloading}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {backupDownloading ? t("settings.preparingBackup") : t("settings.downloadBackup")}
          </button>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setDeleteAllOpen(true);
                setDeleteAllConfirmText("");
                setDeleteAllError(null);
              }}
              className="w-full rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            >
              {t("settings.deleteAllEntries")}
            </button>
          </div>
        </section>

        <section className={sectionClass} aria-labelledby="prefs-heading">
          <h2 id="prefs-heading" className="text-base font-semibold">
            {t("settings.preferences")}
          </h2>
          <form onSubmit={handleSavePreferences} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="ui-locale">
                {t("settings.language")}
              </label>
              <select
                id="ui-locale"
                value={locale}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "en" || v === "ko") {
                    void setUiLocale(v as UiLocale);
                  }
                }}
                className={inputClass}
              >
                <option value="en">{t("settings.english")}</option>
                <option value="ko">{t("settings.korean")}</option>
              </select>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("settings.languageHelp")}</p>
            </div>
            <label className="block text-sm font-medium">
              {t("settings.defaultCategory")}
              <select
                value={defaultCategory}
                onChange={(e) =>
                  setDefaultCategory(e.target.value as DefaultCategoryPreference)
                }
                className={inputClass}
              >
                {categoryPreferenceOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={statsExpandedDefault}
                onChange={(e) => setStatsExpandedDefault(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span>{t("settings.statsExpanded")}</span>
            </label>
            {prefsNotice ? (
              <p className="text-sm text-[#4a4a4a] dark:text-[#a3a3a3]">{prefsNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={prefsBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {prefsBusy ? t("settings.savingPrefs") : t("settings.savePreferences")}
            </button>
          </form>
        </section>

        <section className={sectionClass} aria-labelledby="tags-heading">
          <h2 id="tags-heading" className="text-base font-semibold">
            {t("settings.tagsSection")}
          </h2>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {t("settings.totalTags")}{" "}
            <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
              {tagsCatalogBusy ? "…" : tagsCatalog.length}
            </span>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("settings.tagsHelp")}</p>
          {tagsCatalogError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{tagsCatalogError}</p>
          ) : null}
          {tagsCatalogBusy ? (
            <p className="text-sm text-zinc-500">{t("settings.loadingTags")}</p>
          ) : tagsCatalog.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("settings.noTagsYet")}</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
              {tagsCatalog.map((row) => (
                <li
                  key={row.tag}
                  className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                >
                  {renameTargetTag === row.tag ? (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        className={`${inputClass} max-w-xs shrink py-1.5 text-sm`}
                        aria-label={t("common.settingsNewTagNameAria")}
                      />
                      <button
                        type="button"
                        disabled={tagRenameBusy !== null}
                        onClick={() =>
                          void (async () => {
                            await handleRenameTagEverywhere(row.tag, renameDraft);
                            setRenameTargetTag(null);
                          })()
                        }
                        className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {t("common.apply")}
                      </button>
                      <button
                        type="button"
                        disabled={tagRenameBusy !== null}
                        onClick={() => setRenameTargetTag(null)}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {row.tag}
                        </span>
                        <span className="shrink-0 tabular-nums text-zinc-500">{row.count}</span>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={tagRenameBusy !== null}
                          onClick={() => {
                            setRenameTargetTag(row.tag);
                            setRenameDraft(row.tag);
                          }}
                          className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                        >
                          {t("common.rename")}
                        </button>
                        <button
                          type="button"
                          disabled={tagRenameBusy !== null}
                          onClick={() => void handleDeleteTagEverywhere(row.tag)}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-800 dark:border-red-900 dark:text-red-200"
                        >
                          {tagRenameBusy === row.tag ? "…" : t("common.delete")}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void refreshTagsCatalog()}
            disabled={tagsCatalogBusy}
            className="mt-2 text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
          >
            {t("settings.refreshList")}
          </button>
        </section>
      </main>

      {deleteAllOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 p-4 sm:items-center"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteAllBusy) {
              setDeleteAllOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-labelledby="delete-all-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-all-title" className="text-lg font-semibold text-red-900 dark:text-red-200">
              {t("settings.deleteAllTitle")}
            </h3>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              {t("settings.deleteAllBody", { count: n })}
            </p>
            <input
              type="text"
              value={deleteAllConfirmText}
              onChange={(e) => setDeleteAllConfirmText(e.target.value)}
              className={`${inputClass} mt-3 font-mono`}
              placeholder={t("settings.placeholderDelete")}
              autoComplete="off"
              disabled={deleteAllBusy}
            />
            {deleteAllError ? (
              <p className="mt-2 text-sm text-red-700 dark:text-red-300">{deleteAllError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={deleteAllBusy || deleteAllConfirmText !== "DELETE"}
                onClick={() => void handleDeleteAllEntries()}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {deleteAllBusy ? t("settings.deleting") : t("settings.confirmDeleteAll")}
              </button>
              <button
                type="button"
                disabled={deleteAllBusy}
                onClick={() => setDeleteAllOpen(false)}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
