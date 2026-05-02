"use client";

import { supabase } from "@/lib/supabase";
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
import { FormEvent, useCallback, useEffect, useState } from "react";

const BACKUP_APP_VERSION = "1.0";

const CATEGORY_OPTIONS: { value: DefaultCategoryPreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "health", label: "Health" },
  { value: "relationships", label: "Relationships" },
  { value: "career", label: "Career" },
  { value: "logistics", label: "Logistics" },
  { value: "emotional", label: "Emotional" },
  { value: "finance", label: "Finance" },
  { value: "ideas", label: "Ideas" },
  { value: "learning", label: "Learning" },
  { value: "reflection", label: "Reflection" },
  { value: "other", label: "Other" },
];

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

const sectionClass =
  "space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

export default function SettingsPage() {
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

  const [signOutBusy, setSignOutBusy] = useState(false);

  const refreshLocalBackupLabel = useCallback(() => {
    try {
      setLastBackupIso(localStorage.getItem(LAST_BACKUP_STORAGE_KEY));
    } catch {
      setLastBackupIso(null);
    }
  }, []);

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
    })();
    return () => {
      cancelled = true;
    };
  }, [router, refreshLocalBackupLabel]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    setProfileNotice(null);
    if (pronounsPreset === "custom") {
      const s = pronounsSubject.trim();
      const o = pronounsObject.trim();
      const p = pronounsPossessive.trim();
      if (!s || !o || !p) {
        setProfileError("Enter subject, object, and possessive pronouns for Custom.");
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
      setProfileNotice("Saved.");
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
      setPasswordError("New passwords don't match.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (!email) {
      setPasswordError("No email on session.");
      return;
    }
    setPasswordBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signErr) {
        setPasswordError("Current password is incorrect.");
        return;
      }
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
      if (upErr) {
        setPasswordError(upErr.message);
        return;
      }
      setPasswordNotice("Password updated.");
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
        .select("id, created_at, text, category, user_id")
        .order("created_at", { ascending: true });

      if (error) {
        setBackupError("Could not download backup. Please try again.");
        setBackupDownloading(false);
        return;
      }

      type BackupRow = {
        id: number;
        created_at: string;
        text: string | null;
        category: string | null;
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
      setBackupNotice("Backup downloaded.");
      setTimeout(() => setBackupNotice(null), 4000);
    } catch {
      setBackupError("Could not download backup. Please try again.");
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
      setDeleteAllError("Not signed in.");
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
      setBackupNotice("All entries deleted.");
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
      setPrefsNotice("Preferences saved.");
      setTimeout(() => setPrefsNotice(null), 3000);
    } finally {
      setPrefsBusy(false);
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
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  const n = entryCount ?? 0;

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:max-w-xl sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Back to app
          </Link>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Account, data, and preferences.</p>
        </header>

        <section className={sectionClass} aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-base font-semibold">
            Account
          </h2>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Email
            </p>
            <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{email || "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">Your sign-in identifier (read-only).</p>
          </div>

          <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-4">
            <label className="block text-sm font-medium">
              Display name
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
                Pronouns
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
                Used when saving entries in third person. Pronoun changes apply to new entries only;
                existing entries are preserved as-is.
              </p>
            </div>

            {pronounsPreset === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm font-medium">
                  Subject
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
                  Object
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
                  Possessive
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
              <p className="text-sm text-emerald-800 dark:text-emerald-200">{profileNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={profileBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {profileBusy ? "Saving…" : "Save profile"}
            </button>
          </form>

          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="text-sm font-medium">Change password</p>
            <label className="block text-sm font-medium">
              Current password
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                autoComplete="current-password"
              />
            </label>
            <label className="block text-sm font-medium">
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm new password
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
              <p className="text-sm text-emerald-800 dark:text-emerald-200">{passwordNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={passwordBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {passwordBusy ? "Updating…" : "Update password"}
            </button>
          </form>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signOutBusy}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-950"
            >
              {signOutBusy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>

        <section className={sectionClass} aria-labelledby="data-heading">
          <h2 id="data-heading" className="text-base font-semibold">
            Data management
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Total entries:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{entryCount ?? "—"}</span>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Last backup:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {lastBackupIso ? formatBackupCalendarLabel(lastBackupIso) : "Never"}
            </span>
          </p>
          {backupNotice ? (
            <p className="text-sm text-emerald-800 dark:text-emerald-200">{backupNotice}</p>
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
            {backupDownloading ? "Preparing…" : "Download full backup"}
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
              Delete all entries
            </button>
          </div>
        </section>

        <section className={sectionClass} aria-labelledby="prefs-heading">
          <h2 id="prefs-heading" className="text-base font-semibold">
            Preferences
          </h2>
          <form onSubmit={handleSavePreferences} className="space-y-4">
            <label className="block text-sm font-medium">
              Default category for new entries
              <select
                value={defaultCategory}
                onChange={(e) =>
                  setDefaultCategory(e.target.value as DefaultCategoryPreference)
                }
                className={inputClass}
              >
                {CATEGORY_OPTIONS.map((opt) => (
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
              <span>Show stats section by default on the Entries tab</span>
            </label>
            {prefsNotice ? (
              <p className="text-sm text-emerald-800 dark:text-emerald-200">{prefsNotice}</p>
            ) : null}
            <button
              type="submit"
              disabled={prefsBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {prefsBusy ? "Saving…" : "Save preferences"}
            </button>
          </form>
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
              Delete all entries?
            </h3>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              This will permanently delete all {n} entries. This cannot be undone. Type{" "}
              <span className="font-mono font-semibold">DELETE</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteAllConfirmText}
              onChange={(e) => setDeleteAllConfirmText(e.target.value)}
              className={`${inputClass} mt-3 font-mono`}
              placeholder="DELETE"
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
                {deleteAllBusy ? "Deleting…" : "Confirm delete all"}
              </button>
              <button
                type="button"
                disabled={deleteAllBusy}
                onClick={() => setDeleteAllOpen(false)}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
