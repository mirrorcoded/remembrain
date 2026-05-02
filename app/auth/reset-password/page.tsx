"use client";

import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const href = window.location.href;
      const url = new URL(href);

      if (url.searchParams.has("code")) {
        const { error } = await supabase.auth.exchangeCodeForSession(href);
        if (error) {
          if (!cancelled) {
            setSessionMessage(
              "This reset link is invalid or has expired. Request a new one from the sign-in page.",
            );
            setSessionReady(false);
            setCheckingSession(false);
          }
          return;
        }
      }

      let session = (await supabase.auth.getSession()).data.session;

      if (!session && !url.searchParams.has("code") && url.hash.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        session = (await supabase.auth.getSession()).data.session;
      }

      if (cancelled) {
        return;
      }

      if (session) {
        setSessionReady(true);
        setSessionMessage(null);
      } else {
        setSessionReady(false);
        setSessionMessage(
          "This reset link is invalid or has expired. Request a new one from the sign-in page.",
        );
      }

      setCheckingSession(false);
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        setSessionReady(true);
        setSessionMessage(null);
        setCheckingSession(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  function clearMismatchIfNeeded() {
    setFormError((previous) => (previous === "Passwords don't match" ? null : previous));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (password !== confirmPassword) {
      setFormError("Passwords don't match");
      return;
    }

    if (password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Remembrain</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Set a new password</p>
        </header>

        {checkingSession ? (
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
        ) : !sessionReady ? (
          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{sessionMessage}</p>
            <p className="text-center text-sm">
              <Link
                href="/"
                className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <label className="block text-sm font-medium">
              New password
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMismatchIfNeeded();
                }}
                className={inputClass}
                required
                minLength={6}
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm new password
              <input
                type="password"
                name="confirmNewPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  clearMismatchIfNeeded();
                }}
                className={inputClass}
                required
                minLength={6}
              />
            </label>

            {formError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Please wait…" : "Update password"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
