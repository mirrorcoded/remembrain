"use client";

import type { Session } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type Category =
  | "health"
  | "relationships"
  | "career"
  | "logistics"
  | "emotional"
  | "finance"
  | "ideas"
  | "learning"
  | "reflection"
  | "other";

type Entry = {
  id: number;
  text: string;
  created_at: string;
  category: Category;
};

type SpeechRecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
};

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type ExportFormat = "markdown" | "text" | "json";
type ExportScope = "all" | "filtered" | "date-range";
type NewEntryCategorySelection = "auto" | Category;
type ProcessApiEntry = { text?: string; category?: string };
type ChatMessage = { role: "user" | "assistant"; content: string };

function formatTimestamp(timestamp: string): string {
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));

  return `${datePart} at ${timePart}`;
}

function formatDateHeading(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatTimeOnly(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const CATEGORY_BADGE_STYLES: Record<Category, string> = {
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
  ideas:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  learning:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  reflection:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  other: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

/** Solid fills for stats bars (same hues as category badges). */
const CATEGORY_BAR_FILL_CLASSES: Record<Category, string> = {
  health: "bg-emerald-500 dark:bg-emerald-400",
  relationships: "bg-pink-500 dark:bg-pink-400",
  career: "bg-blue-500 dark:bg-blue-400",
  logistics: "bg-zinc-500 dark:bg-zinc-400",
  emotional: "bg-violet-500 dark:bg-violet-400",
  finance: "bg-amber-500 dark:bg-amber-400",
  ideas: "bg-orange-500 dark:bg-orange-400",
  learning: "bg-teal-500 dark:bg-teal-400",
  reflection: "bg-indigo-500 dark:bg-indigo-400",
  other: "bg-zinc-400 dark:bg-zinc-500",
};

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CATEGORY_ORDER: Category[] = [
  "health",
  "relationships",
  "career",
  "logistics",
  "emotional",
  "finance",
  "ideas",
  "learning",
  "reflection",
  "other",
];

const ALL_CATEGORIES: Category[] = [...CATEGORY_ORDER];

const CATEGORY_LABELS: Record<Category, string> = {
  health: "Health",
  relationships: "Relationships",
  career: "Career",
  logistics: "Logistics",
  emotional: "Emotional",
  finance: "Finance",
  ideas: "Ideas",
  learning: "Learning",
  reflection: "Reflection",
  other: "Other",
};

const LAST_BACKUP_STORAGE_KEY = "remembrain_last_backup";
const BACKUP_BANNER_SNOOZE_UNTIL_KEY = "remembrain_backup_banner_snooze_until";
const BACKUP_APP_VERSION = "1.0";
const BACKUP_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const BACKUP_BANNER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function formatBackupCalendarLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function parseLastBackupMs(iso: string | null): number | null {
  if (!iso) {
    return null;
  }
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function isBackupStale(lastBackupIso: string | null, nowMs: number): boolean {
  const ms = parseLastBackupMs(lastBackupIso);
  if (ms == null) {
    return true;
  }
  return nowMs - ms > BACKUP_STALE_MS;
}

function sanitizeCategory(value: string): Category {
  const normalizedCategory = value.trim().toLowerCase();
  switch (normalizedCategory) {
    case "health":
    case "relationships":
    case "career":
    case "logistics":
    case "emotional":
    case "finance":
    case "ideas":
    case "learning":
    case "reflection":
    case "other":
      return normalizedCategory;
    default:
      return "other";
  }
}

export default function Home() {
  const [text, setText] = useState("");
  const [newEntryCategorySelection, setNewEntryCategorySelection] =
    useState<NewEntryCategorySelection>("auto");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | Category>("all");
  const [isMounted, setIsMounted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechErrorMessage, setSpeechErrorMessage] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category>("other");
  const [isUpdatingEntry, setIsUpdatingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [selectedExportCategories, setSelectedExportCategories] = useState<Category[]>(
    ALL_CATEGORIES,
  );
  const [copyFeedback, setCopyFeedback] = useState("");
  const [saveNoticeMessage, setSaveNoticeMessage] = useState("");
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveInlineStatus, setSaveInlineStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"entries" | "ask">("entries");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [askInput, setAskInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");
  const [authView, setAuthView] = useState<"credentials" | "forgotPassword">("credentials");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [lastBackupIso, setLastBackupIso] = useState<string | null>(null);
  const [bannerSnoozeUntilMs, setBannerSnoozeUntilMs] = useState<number | null>(null);
  const [isBackupDownloading, setIsBackupDownloading] = useState(false);
  const [backupNoticeMessage, setBackupNoticeMessage] = useState("");
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);
  const [clockTickMs, setClockTickMs] = useState(() => Date.now());
  const [speechRecognitionCtor, setSpeechRecognitionCtor] =
    useState<SpeechRecognitionConstructor | null>(null);
  const isSpeechSupported = speechRecognitionCtor !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  /** When true, recognition `onend` skips committing transcript (e.g. save stopped the mic). */
  const speechDiscardCommitRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const askTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const statsCategoryRows = useMemo(() => {
    const counts: Record<Category, number> = {
      health: 0,
      relationships: 0,
      career: 0,
      logistics: 0,
      emotional: 0,
      finance: 0,
      ideas: 0,
      learning: 0,
      reflection: 0,
      other: 0,
    };
    for (const entry of entries) {
      counts[entry.category] += 1;
    }
    return ALL_CATEGORIES.map((category) => ({
      category,
      count: counts[category],
    })).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.category.localeCompare(b.category);
    });
  }, [entries]);

  const statsLast30Days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 29);

    const countsByDay = new Map<string, number>();
    for (const entry of entries) {
      const d = new Date(entry.created_at);
      d.setHours(0, 0, 0, 0);
      if (d >= windowStart && d <= today) {
        const key = formatLocalYmd(d);
        countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
      }
    }

    const rows: { dayLabel: string; count: number; ymd: string }[] = [];
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i);
      const key = formatLocalYmd(d);
      rows.push({
        dayLabel: String(d.getDate()),
        count: countsByDay.get(key) ?? 0,
        ymd: key,
      });
    }
    return rows;
  }, [entries]);

  const statsDailyMax = useMemo(
    () => statsLast30Days.reduce((max, row) => Math.max(max, row.count), 0),
    [statsLast30Days],
  );

  const statsCategoryMax = useMemo(
    () => statsCategoryRows.reduce((max, row) => Math.max(max, row.count), 0),
    [statsCategoryRows],
  );

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return entries.filter((entry) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        entry.text.toLowerCase().includes(normalizedSearch);
      const matchesCategory =
        activeCategory === "all" || entry.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [entries, searchQuery, activeCategory]);

  const isFilterActive = searchQuery.trim().length > 0 || activeCategory !== "all";

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("entries")
      .select("id, created_at, text, category")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage("Could not load entries. Please try again.");
      setIsLoading(false);
      return;
    }

    const normalizedEntries: Entry[] = (data ?? []).map((entry) => ({
      ...entry,
      category: sanitizeCategory(entry.category ?? "other"),
    }));

    setEntries(normalizedEntries);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setIsMounted(true);

      const speechWindow = window as Window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
      const recognitionConstructor =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
      setSpeechRecognitionCtor(() => recognitionConstructor);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isMounted) {
      return;
    }
    const timeoutId = setTimeout(() => {
      try {
        setLastBackupIso(localStorage.getItem(LAST_BACKUP_STORAGE_KEY));
        const rawSnooze = localStorage.getItem(BACKUP_BANNER_SNOOZE_UNTIL_KEY);
        const snoozeNum = rawSnooze ? Number(rawSnooze) : NaN;
        setBannerSnoozeUntilMs(Number.isFinite(snoozeNum) ? snoozeNum : null);
      } catch {
        // ignore private mode / quota
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [isMounted]);

  useEffect(() => {
    function resetForSignedOut() {
      setEntries([]);
      setChatMessages([]);
      setIsLoading(false);
      setEditingEntryId(null);
      setEditingText("");
      setEditingCategory("other");
      setSaveNoticeMessage("");
      setSaveInlineStatus("");
      setIsSaving(false);
    }

    void supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      if (!initialSession) {
        resetForSignedOut();
      }
      setAuthHydrated(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        resetForSignedOut();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authHydrated || !session) {
      return;
    }

    const timeoutId = setTimeout(() => {
      void loadEntries();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [authHydrated, session, loadEntries]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "ask") {
      return;
    }
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isAsking, activeTab]);

  useEffect(() => {
    const id = window.setInterval(() => setClockTickMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const backupNeedsReminder = isBackupStale(lastBackupIso, clockTickMs);
  const bannerSnoozeActive =
    bannerSnoozeUntilMs != null &&
    Number.isFinite(bannerSnoozeUntilMs) &&
    clockTickMs < bannerSnoozeUntilMs;
  const showBackupReminderBanner =
    isMounted && backupNeedsReminder && !bannerSnoozeActive;

  function adjustAskTextareaHeight() {
    const el = askTextareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`;
  }

  async function handleDownloadFullBackup() {
    setBackupErrorMessage(null);
    setIsBackupDownloading(true);
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("id, created_at, text, category, user_id")
        .order("created_at", { ascending: true });

      if (error) {
        setBackupErrorMessage("Could not download backup. Please try again.");
        setIsBackupDownloading(false);
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
      const filename = `remembrain-backup-${formatLocalYmd(new Date())}.json`;
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
        // quota / private mode
      }
      setLastBackupIso(exportDate);
      setClockTickMs(Date.now());
      setBackupNoticeMessage("Backup downloaded successfully.");
      setTimeout(() => setBackupNoticeMessage(""), 4000);
    } catch {
      setBackupErrorMessage("Could not download backup. Please try again.");
    } finally {
      setIsBackupDownloading(false);
    }
  }

  function handleDismissBackupBanner() {
    const until = Date.now() + BACKUP_BANNER_SNOOZE_MS;
    try {
      localStorage.setItem(BACKUP_BANNER_SNOOZE_UNTIL_KEY, String(until));
    } catch {
      // still hide in-session
    }
    setBannerSnoozeUntilMs(until);
    setClockTickMs(Date.now());
  }

  async function handleLogout() {
    setAuthBusy(true);
    setAuthError(null);
    await supabase.auth.signOut();
    setAuthBusy(false);
  }

  function clearPasswordMismatchIfNeeded() {
    setAuthError((previous) => (previous === "Passwords don't match" ? null : previous));
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthNotice(null);

    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) {
      setAuthError("Enter email and password.");
      return;
    }

    if (authMode === "signUp") {
      if (password !== authConfirmPassword) {
        setAuthError("Passwords don't match");
        return;
      }
    }

    setAuthBusy(true);
    try {
      if (authMode === "signUp") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setAuthError(error.message);
          return;
        }
        if (data.user && !data.session) {
          setAuthNotice("Check your email to confirm your account, then sign in.");
        }
        setAuthConfirmPassword("");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleForgotPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthNotice(null);

    const email = authEmail.trim();
    if (!email) {
      setAuthError("Enter your email address.");
      return;
    }

    setAuthBusy(true);
    try {
      const redirectTo = `${window.location.origin}/auth/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setAuthNotice(
        "If an account exists for that email, a password reset link has been sent. Check your inbox.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAskSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmedQuestion = askInput.trim();
    if (!trimmedQuestion || isAsking || entries.length === 0) {
      return;
    }

    setAskInput("");
    const textarea = askTextareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
    }

    setChatMessages((previous) => [...previous, { role: "user", content: trimmedQuestion }]);
    setIsAsking(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      if (response.status === 401) {
        setChatMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: "Your session expired. Please sign in again.",
          },
        ]);
        return;
      }

      const payload = (await response.json()) as { answer?: string };
      const answerText =
        typeof payload.answer === "string"
          ? payload.answer
          : "Something went wrong. Please try again.";
      setChatMessages((previous) => [...previous, { role: "assistant", content: answerText }]);
    } catch {
      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  }

  function composeSpeechText(base: string, transcript: string): string {
    if (!transcript.trim()) {
      return base;
    }
    if (!base.trim()) {
      return transcript.trimStart();
    }
    return `${base}${base.endsWith(" ") || transcript.startsWith(" ") ? "" : " "}${transcript}`;
  }

  function startListening() {
    if (!speechRecognitionCtor || isListening) {
      return;
    }

    setSpeechErrorMessage(null);
    speechBaseTextRef.current = text;
    finalTranscriptRef.current = "";

    const recognition = new speechRecognitionCtor();
    recognition.lang = window.navigator.language;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      finalTranscriptRef.current = finalTranscript;
      setText(
        composeSpeechText(speechBaseTextRef.current, `${finalTranscript}${interimTranscript}`),
      );
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setSpeechErrorMessage(
          "Microphone permission was denied. Please allow microphone access and try again.",
        );
      } else {
        setSpeechErrorMessage("Voice input could not start. Please try again.");
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      const discard = speechDiscardCommitRef.current;
      speechDiscardCommitRef.current = false;
      if (!discard) {
        setText(composeSpeechText(speechBaseTextRef.current, finalTranscriptRef.current));
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stopListening(options?: { discardPendingCommit?: boolean }) {
    if (!recognitionRef.current) {
      return;
    }

    if (options?.discardPendingCommit) {
      speechDiscardCommitRef.current = true;
    }

    recognitionRef.current.stop();
    setIsListening(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedText = text.trim();
    if (!trimmedText || isSaving) {
      return;
    }

    const useAutoCategory = newEntryCategorySelection === "auto";

    setIsSaving(true);
    setErrorMessage(null);
    setSaveNoticeMessage("");
    setSaveInlineStatus(useAutoCategory ? "Got it..." : "Saving...");
    stopListening({ discardPendingCommit: true });

    let processedEntries: Array<{ text: string; category: Category }> = [
      { text: trimmedText, category: "other" },
    ];

    function abortSave(restoreText: boolean) {
      if (restoreText) {
        setText(trimmedText);
      }
      setSaveInlineStatus("");
      setIsSaving(false);
    }

    try {
      const processResponse = await fetch("/api/process", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: trimmedText,
          manualCategory: newEntryCategorySelection,
        }),
      });

      if (processResponse.status === 401) {
        setErrorMessage("Your session expired. Please sign in again.");
        abortSave(true);
        return;
      }

      if (processResponse.ok) {
        const result = (await processResponse.json()) as {
          acknowledgment?: string;
          entries?: ProcessApiEntry[];
        };
        const mappedEntries =
          result.entries
            ?.map((entry) => ({
              text: entry.text?.trim() ?? "",
              category: sanitizeCategory(entry.category ?? "other"),
            }))
            .filter((entry) => entry.text.length > 0) ?? [];

        if (mappedEntries.length > 0) {
          processedEntries = mappedEntries;
        }

        if (useAutoCategory) {
          const ack =
            typeof result.acknowledgment === "string" && result.acknowledgment.trim().length > 0
              ? result.acknowledgment.trim()
              : "Noted";
          setSaveInlineStatus(ack);
        }
      }
    } catch {
      if (newEntryCategorySelection !== "auto") {
        processedEntries = [{ text: trimmedText, category: newEntryCategorySelection }];
      }
    }

    for (const entry of processedEntries) {
      const { error } = await supabase
        .from("entries")
        .insert({ text: entry.text, category: entry.category });

      if (error) {
        setErrorMessage("Could not save entry. Please try again.");
        abortSave(true);
        return;
      }
    }

    setText("");
    setNewEntryCategorySelection("auto");
    setSaveInlineStatus("");
    await loadEntries();
    setIsSaving(false);
  }

  function handleStartEdit(entry: Entry) {
    setErrorMessage(null);
    setEditingEntryId(entry.id);
    setEditingText(entry.text);
    setEditingCategory(entry.category);
  }

  function handleCancelEdit() {
    setEditingEntryId(null);
    setEditingText("");
    setEditingCategory("other");
    setIsUpdatingEntry(false);
  }

  async function handleSaveEdit(entryId: number) {
    const trimmedText = editingText.trim();
    if (!trimmedText || isUpdatingEntry) {
      return;
    }

    setIsUpdatingEntry(true);
    setErrorMessage(null);

    const { error } = await supabase
      .from("entries")
      .update({ text: trimmedText, category: editingCategory })
      .eq("id", entryId);

    if (error) {
      setErrorMessage("Could not update entry. Please try again.");
      setIsUpdatingEntry(false);
      return;
    }

    handleCancelEdit();
    await loadEntries();
  }

  async function handleDeleteEntry(entryId: number) {
    const confirmed = window.confirm("Delete this entry?");
    if (!confirmed) {
      return;
    }

    setDeletingEntryId(entryId);
    setErrorMessage(null);

    const { error } = await supabase.from("entries").delete().eq("id", entryId);

    if (error) {
      setErrorMessage("Could not delete entry. Please try again.");
      setDeletingEntryId(null);
      return;
    }

    if (editingEntryId === entryId) {
      handleCancelEdit();
    }

    await loadEntries();
    setDeletingEntryId(null);
  }

  function toggleExportCategory(category: Category) {
    setSelectedExportCategories((previousCategories) =>
      previousCategories.includes(category)
        ? previousCategories.filter((item) => item !== category)
        : [...previousCategories, category],
    );
  }

  const exportableEntries = useMemo(() => {
    const sourceEntries = exportScope === "filtered" ? filteredEntries : entries;

    return sourceEntries.filter((entry) => {
      if (!selectedExportCategories.includes(entry.category)) {
        return false;
      }

      if (exportScope !== "date-range") {
        return true;
      }

      const entryDate = new Date(entry.created_at);
      const entryDateValue = new Date(
        entryDate.getFullYear(),
        entryDate.getMonth(),
        entryDate.getDate(),
      ).getTime();

      if (exportStartDate) {
        const startDateValue = new Date(`${exportStartDate}T00:00:00`).getTime();
        if (entryDateValue < startDateValue) {
          return false;
        }
      }

      if (exportEndDate) {
        const endDateValue = new Date(`${exportEndDate}T00:00:00`).getTime();
        if (entryDateValue > endDateValue) {
          return false;
        }
      }

      return true;
    });
  }, [
    entries,
    filteredEntries,
    exportScope,
    selectedExportCategories,
    exportStartDate,
    exportEndDate,
  ]);

  function buildMarkdownExport(entriesToExport: Entry[]): string {
    const lines: string[] = [
      "# Remembrain Export",
      `Generated: ${new Date().toLocaleString()}`,
      `Total entries: ${entriesToExport.length}`,
      "",
    ];

    let currentDateHeading = "";
    entriesToExport.forEach((entry) => {
      const dateHeading = formatDateHeading(entry.created_at);
      if (dateHeading !== currentDateHeading) {
        currentDateHeading = dateHeading;
        lines.push(`## ${dateHeading}`);
      }

      lines.push(
        `- ${formatTimeOnly(entry.created_at)} - ${CATEGORY_LABELS[entry.category]}`,
        `${entry.text}`,
        "",
      );
    });

    return lines.join("\n").trim();
  }

  function buildTextExport(entriesToExport: Entry[]): string {
    const lines: string[] = [
      "Remembrain Export",
      `Generated: ${new Date().toLocaleString()}`,
      `Total entries: ${entriesToExport.length}`,
      "",
    ];

    let currentDateHeading = "";
    entriesToExport.forEach((entry) => {
      const dateHeading = formatDateHeading(entry.created_at);
      if (dateHeading !== currentDateHeading) {
        currentDateHeading = dateHeading;
        lines.push(dateHeading);
      }

      lines.push(
        `${formatTimeOnly(entry.created_at)} - ${CATEGORY_LABELS[entry.category]}`,
        `${entry.text}`,
        "",
      );
    });

    return lines.join("\n").trim();
  }

  const exportContent = useMemo(() => {
    if (exportFormat === "json") {
      return JSON.stringify(
        exportableEntries.map((entry) => ({
          id: entry.id,
          created_at: entry.created_at,
          text: entry.text,
          category: entry.category,
        })),
        null,
        2,
      );
    }

    if (exportFormat === "text") {
      return buildTextExport(exportableEntries);
    }

    return buildMarkdownExport(exportableEntries);
  }, [exportFormat, exportableEntries]);

  async function handleCopyExport() {
    try {
      await navigator.clipboard.writeText(exportContent);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(""), 1500);
    } catch {
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(""), 1500);
    }
  }

  function handleDownloadExport() {
    const extension = exportFormat === "markdown" ? "md" : exportFormat === "text" ? "txt" : "json";
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `remembrain-export-${datePart}.${extension}`;
    const blob = new Blob([exportContent], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  if (!authHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (!session) {
    const authInputClass =
      "mt-1 w-full min-h-11 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

    return (
      <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
          <header className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Remembrain</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {authView === "forgotPassword"
                ? "Enter your email and we’ll send a reset link."
                : "Sign in to access your journal."}
            </p>
          </header>

          {authView === "forgotPassword" ? (
            <form
              onSubmit={(event) => void handleForgotPasswordSubmit(event)}
              className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="block text-sm font-medium">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  className={authInputClass}
                  required
                />
              </label>

              {authError ? (
                <p className="text-sm text-red-700 dark:text-red-300">{authError}</p>
              ) : null}
              {authNotice ? (
                <p className="text-sm text-emerald-800 dark:text-emerald-200">{authNotice}</p>
              ) : null}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {authBusy ? "Please wait…" : "Send reset email"}
              </button>

              <p className="text-center text-sm">
                <button
                  type="button"
                  className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                  onClick={() => {
                    setAuthView("credentials");
                    setAuthError(null);
                    setAuthNotice(null);
                  }}
                >
                  Back to sign in
                </button>
              </p>
            </form>
          ) : (
            <form
              onSubmit={(event) => void handleAuthSubmit(event)}
              className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="block text-sm font-medium">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  className={authInputClass}
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete={authMode === "signUp" ? "new-password" : "current-password"}
                  value={authPassword}
                  onChange={(event) => {
                    setAuthPassword(event.target.value);
                    clearPasswordMismatchIfNeeded();
                  }}
                  className={authInputClass}
                  required
                />
              </label>
              {authMode === "signUp" ? (
                <label className="block text-sm font-medium">
                  Confirm password
                  <input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={authConfirmPassword}
                    onChange={(event) => {
                      setAuthConfirmPassword(event.target.value);
                      clearPasswordMismatchIfNeeded();
                    }}
                    className={authInputClass}
                    required
                  />
                </label>
              ) : null}

              {authError ? (
                <p className="text-sm text-red-700 dark:text-red-300">{authError}</p>
              ) : null}
              {authNotice ? (
                <p className="text-sm text-emerald-800 dark:text-emerald-200">{authNotice}</p>
              ) : null}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {authBusy ? "Please wait…" : authMode === "signUp" ? "Create account" : "Sign in"}
              </button>

              {authMode === "signIn" ? (
                <p className="text-center text-sm">
                  <button
                    type="button"
                    className="text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                    onClick={() => {
                      setAuthView("forgotPassword");
                      setAuthError(null);
                      setAuthNotice(null);
                    }}
                  >
                    Forgot password?
                  </button>
                </p>
              ) : null}

              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                {authMode === "signUp" ? "Already have an account?" : "Need an account?"}{" "}
                <button
                  type="button"
                  className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                  onClick={() => {
                    setAuthMode((mode) => (mode === "signUp" ? "signIn" : "signUp"));
                    setAuthError(null);
                    setAuthNotice(null);
                    setAuthConfirmPassword("");
                  }}
                >
                  {authMode === "signUp" ? "Sign in" : "Sign up"}
                </button>
              </p>
            </form>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Remembrain</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Capture your thoughts and keep your memories close.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={authBusy}
            className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Log out
          </button>
        </header>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("entries")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === "entries"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Entries
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ask")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === "ask"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Ask
          </button>
        </div>

        {activeTab === "entries" ? (
          <>
            {showBackupReminderBanner ? (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="min-w-0 flex-1">
                  It&apos;s been over a month since your last backup. Download one now.
                </p>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDownloadFullBackup()}
                    disabled={isBackupDownloading}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {isBackupDownloading ? "Downloading…" : "Download"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissBackupBanner}
                    className="rounded-lg border border-amber-800/40 bg-white px-3 py-2 text-xs font-medium text-amber-950 transition hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            <form
          onSubmit={handleSave}
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <label htmlFor="entry" className="mb-2 block text-sm font-medium">
            New Journal Entry
          </label>
          <div className="relative">
            <textarea
              id="entry"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="What are you thinking about?"
              disabled={isSaving}
              className="min-h-32 w-full resize-y rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 pr-14 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
            {isMounted && isSpeechSupported ? (
              <button
                type="button"
                onClick={() => {
                  if (isListening) {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
                disabled={isSaving}
                aria-label={isListening ? "Stop voice input" : "Start voice input"}
                className={`absolute bottom-3 right-3 inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isListening
                    ? "animate-pulse bg-red-600 text-white hover:bg-red-500"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                }`}
              >
                {isListening ? "Listening..." : "Mic"}
              </button>
            ) : null}
          </div>
          {speechErrorMessage ? (
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">{speechErrorMessage}</p>
          ) : null}
          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium">Category</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNewEntryCategorySelection("auto")}
                disabled={isSaving}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  newEntryCategorySelection === "auto"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                Auto
              </button>
              {ALL_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setNewEntryCategorySelection(category)}
                  disabled={isSaving}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    newEntryCategorySelection === category
                      ? CATEGORY_BADGE_STYLES[category]
                      : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
          </div>
          {isSaving ? (
            <p
              className="mt-3 w-full rounded-xl border border-transparent px-4 py-2.5 text-center text-sm text-zinc-600 dark:text-zinc-400"
              role="status"
              aria-live="polite"
            >
              {saveInlineStatus}
            </p>
          ) : (
            <button
              type="submit"
              className="mt-3 w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 active:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              disabled={!text.trim()}
            >
              Save
            </button>
          )}
        </form>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">Stats</h2>
            <button
              type="button"
              onClick={() => setStatsExpanded((open) => !open)}
              className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              {statsExpanded ? "Hide stats" : "Show stats"}
            </button>
          </div>
          {statsExpanded ? (
            <div className="mt-4 space-y-8">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Total entries
                </p>
                <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
                  {entries.length}
                </p>
              </div>

              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  By category
                </p>
                <div className="space-y-2">
                  {statsCategoryRows.map(({ category, count }) => (
                    <div key={category} className="flex items-center gap-2 text-xs">
                      <span className="w-[7.5rem] shrink-0 truncate text-zinc-600 dark:text-zinc-400">
                        {CATEGORY_LABELS[category]}
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className={`h-full rounded-full ${CATEGORY_BAR_FILL_CLASSES[category]}`}
                            style={{
                              width:
                                statsCategoryMax > 0
                                  ? `${(count / statsCategoryMax) * 100}%`
                                  : "0%",
                            }}
                          />
                        </div>
                        <span className="w-7 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                          {count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Last 30 days
                </p>
                <div className="flex gap-3">
                  <div className="flex shrink-0 flex-col justify-between pb-5 pt-1 text-right text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    <span>{statsDailyMax}</span>
                    <span>0</span>
                  </div>
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex min-h-[112px] flex-row items-end gap-px pb-1">
                      {statsLast30Days.map((day) => (
                        <div
                          key={day.ymd}
                          className="flex min-w-[8px] flex-1 flex-col justify-end"
                          title={`${day.ymd}: ${day.count}`}
                        >
                          <div className="relative flex h-24 w-full flex-col justify-end">
                            <div
                              className={`w-full rounded-t ${day.count > 0 ? "bg-zinc-800 dark:bg-zinc-200" : "bg-transparent"}`}
                              style={{
                                height:
                                  statsDailyMax > 0
                                    ? `${(day.count / statsDailyMax) * 100}%`
                                    : "0%",
                                minHeight: day.count > 0 ? 2 : 0,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-row gap-px pt-1 text-[10px] leading-none text-zinc-500 dark:text-zinc-400">
                      {statsLast30Days.map((day) => (
                        <span key={`${day.ymd}-label`} className="min-w-[8px] flex-1 text-center">
                          {day.dayLabel}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium">Backup</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Download a complete JSON copy of all your entries (ignores search and filters).
          </p>
          {backupNoticeMessage ? (
            <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
              {backupNoticeMessage}
            </p>
          ) : null}
          {backupErrorMessage ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
              {backupErrorMessage}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => void handleDownloadFullBackup()}
              disabled={isBackupDownloading}
              className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:w-auto"
            >
              {isBackupDownloading ? "Preparing backup…" : "Download Full Backup"}
            </button>
            <div
              className={`text-sm ${
                backupNeedsReminder
                  ? "font-medium text-amber-800 dark:text-amber-200"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {lastBackupIso ? (
                <>
                  Last backup: {formatBackupCalendarLabel(lastBackupIso)}
                  {backupNeedsReminder ? (
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-300">
                      Backup recommended
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  No backup yet
                  <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-300">
                    Backup recommended
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Saved Entries</h2>
          {saveNoticeMessage ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
              {saveNoticeMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
              {errorMessage}
            </p>
          ) : null}
          {isLoading ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              Loading entries...
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              No entries yet. Start with your first memory.
            </p>
          ) : (
            <>
              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="entry-search" className="block text-sm font-medium">
                    Search Entries
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIsExportModalOpen(true)}
                      className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadFullBackup()}
                      disabled={isBackupDownloading}
                      className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                      title="Full JSON backup (all entries)"
                    >
                      {isBackupDownloading ? "Backup…" : "Backup JSON"}
                    </button>
                  </div>
                </div>
                <input
                  id="entry-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by text..."
                  className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveCategory("all")}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      activeCategory === "all"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    All
                  </button>
                  {ALL_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        activeCategory === category
                          ? CATEGORY_BADGE_STYLES[category]
                          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {CATEGORY_LABELS[category]}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Showing {filteredEntries.length} of {entries.length} entries
                </p>
              </div>

              {filteredEntries.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                  No entries match your search.
                </p>
              ) : (
                <ul className="space-y-3">
                  {filteredEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatTimestamp(entry.created_at)}
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {editingEntryId === entry.id ? (
                            <select
                              value={editingCategory}
                              onChange={(event) =>
                                setEditingCategory(
                                  sanitizeCategory(event.target.value),
                                )
                              }
                              className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                            >
                              {ALL_CATEGORIES.map((category) => (
                                <option key={category} value={category}>
                                  {CATEGORY_LABELS[category]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${CATEGORY_BADGE_STYLES[entry.category]}`}
                            >
                              {CATEGORY_LABELS[entry.category]}
                            </span>
                          )}
                          <button
                            type="button"
                            aria-label="Edit entry"
                            onClick={() => handleStartEdit(entry)}
                            disabled={isUpdatingEntry || deletingEntryId === entry.id}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            aria-label="Delete entry"
                            onClick={() => void handleDeleteEntry(entry.id)}
                            disabled={isUpdatingEntry || deletingEntryId === entry.id}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                          >
                            {deletingEntryId === entry.id ? "…" : "🗑️"}
                          </button>
                        </div>
                      </div>
                      {editingEntryId === entry.id ? (
                        <>
                          <textarea
                            value={editingText}
                            onChange={(event) => setEditingText(event.target.value)}
                            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSaveEdit(entry.id)}
                              disabled={!editingText.trim() || isUpdatingEntry}
                              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                            >
                              {isUpdatingEntry ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              disabled={isUpdatingEntry}
                              className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                          {entry.text}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
          </>
        ) : (
          <section className="flex min-h-[min(70vh,560px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {!isLoading && entries.length === 0 ? (
              <p className="border-b border-zinc-200 px-4 py-3 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                Add some entries first, then come back here.
              </p>
            ) : null}
            <div
              ref={chatScrollRef}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 sm:px-4"
            >
              {chatMessages.length === 0 && !isAsking ? (
                <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Ask Remembrain about your life
                </p>
              ) : null}
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[min(100%,24rem)] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      message.role === "user"
                        ? "bg-blue-600 text-white dark:bg-blue-500"
                        : "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {isAsking ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-zinc-200 px-4 py-2.5 text-sm italic text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    thinking...
                  </div>
                </div>
              ) : null}
            </div>
            <form
              onSubmit={(event) => void handleAskSubmit(event)}
              className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-end"
            >
              <textarea
                ref={askTextareaRef}
                rows={1}
                value={askInput}
                onChange={(event) => {
                  setAskInput(event.target.value);
                  requestAnimationFrame(adjustAskTextareaHeight);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAskSubmit();
                  }
                }}
                placeholder={
                  !isLoading && entries.length === 0
                    ? "Add entries on the Entries tab first…"
                    : "Ask a question…"
                }
                disabled={isAsking || isLoading || entries.length === 0}
                className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
              />
              <button
                type="submit"
                disabled={isAsking || !askInput.trim() || isLoading || entries.length === 0}
                className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:w-auto sm:self-stretch sm:px-6"
              >
                Send
              </button>
            </form>
          </section>
        )}
      </main>
      {isExportModalOpen ? (
        <div
          className="fixed inset-0 z-40 bg-zinc-950/40 px-4 py-6"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsExportModalOpen(false);
            }
          }}
        >
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Export Entries</h3>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                aria-label="Close export modal"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Format</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "markdown", label: "Markdown (.md)" },
                    { id: "text", label: "Plain text (.txt)" },
                    { id: "json", label: "JSON (.json)" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setExportFormat(option.id as ExportFormat)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        exportFormat === option.id
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Scope</p>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="export-scope"
                      value="all"
                      checked={exportScope === "all"}
                      onChange={() => setExportScope("all")}
                    />
                    All entries
                  </label>
                  {isFilterActive ? (
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="export-scope"
                        value="filtered"
                        checked={exportScope === "filtered"}
                        onChange={() => setExportScope("filtered")}
                      />
                      Currently filtered entries
                    </label>
                  ) : null}
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="export-scope"
                      value="date-range"
                      checked={exportScope === "date-range"}
                      onChange={() => setExportScope("date-range")}
                    />
                    By date range
                  </label>
                </div>
                {exportScope === "date-range" ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs">
                      Start date
                      <input
                        type="date"
                        value={exportStartDate}
                        onChange={(event) => setExportStartDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                      />
                    </label>
                    <label className="text-xs">
                      End date
                      <input
                        type="date"
                        value={exportEndDate}
                        onChange={(event) => setExportEndDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Categories</p>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {ALL_CATEGORIES.map((category) => (
                    <label key={category} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedExportCategories.includes(category)}
                        onChange={() => toggleExportCategory(category)}
                      />
                      {CATEGORY_LABELS[category]}
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {exportableEntries.length} entries selected for export
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyExport()}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Copy to Clipboard
                </button>
                <button
                  type="button"
                  onClick={handleDownloadExport}
                  className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  Download File
                </button>
                {copyFeedback ? (
                  <span className="self-center text-sm text-emerald-700 dark:text-emerald-300">
                    {copyFeedback}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
