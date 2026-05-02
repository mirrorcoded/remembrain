"use client";

import type { Session } from "@supabase/supabase-js";
import {
  FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";

import { useI18n } from "@/components/I18nProvider";
import {
  KNOWN_CATEGORIES,
  categoryBadgeClass,
  categoryBarFillClass,
  categoryDisplayLabel,
  entryMatchesKnownCategoryFilter,
  isKnownCategory,
  isMissingTagsColumnError,
  normalizeTagList,
  persistEntryCategory,
  sanitizeCategoryForStorage,
  type KnownCategory,
} from "@/lib/categories";
import {
  categoryLabelForLocale,
  intlLocaleForUi,
  speechRecognitionLang,
} from "@/lib/i18n";
import {
  readDefaultCategoryPreference,
  readStatsExpandedPreference,
} from "@/lib/remembrain-preferences";
import { supabase } from "@/lib/supabase";
import { greetingLineForUser } from "@/lib/user-profile";

type Entry = {
  id: number;
  text: string;
  created_at: string;
  category: string;
  tags: string[];
  /** Optimistic row before Supabase insert completes */
  pending?: boolean;
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
type NewEntryCategorySelection = "auto" | KnownCategory;
type ProcessApiEntry = { text?: string; category?: string; tags?: unknown };
type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatThreadRow = {
  id: string;
  title: string | null;
  updated_at: string;
  created_at: string;
};

function formatTimestamp(timestamp: string, intlLoc: string): string {
  return new Intl.DateTimeFormat(intlLoc, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatDateHeading(timestamp: string, intlLoc: string): string {
  return new Intl.DateTimeFormat(intlLoc, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatTimeOnly(timestamp: string, intlLoc: string): string {
  return new Intl.DateTimeFormat(intlLoc, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const ALL_CATEGORIES: KnownCategory[] = [...KNOWN_CATEGORIES];

/** OR logic: entry matches if it has any of the selected tags (case-insensitive). */
function entryMatchesSelectedTags(entryTags: string[], selected: string[]): boolean {
  if (selected.length === 0) {
    return true;
  }
  const lower = (s: string) => s.toLowerCase();
  return entryTags.some((t) => selected.some((s) => lower(t) === lower(s)));
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Labels for Saved Entries date separators (local calendar). */
function formatEntryDateGroupLabel(
  iso: string,
  referenceNow: Date,
  intlLoc: string,
  todayLabel: string,
  yesterdayLabel: string,
): string {
  const entryDate = new Date(iso);
  const startEntry = startOfLocalDay(entryDate);
  const startToday = startOfLocalDay(referenceNow);
  const diffDays = Math.round(
    (startToday.getTime() - startEntry.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (diffDays === 0) {
    return todayLabel;
  }
  if (diffDays === 1) {
    return yesterdayLabel;
  }
  if (diffDays >= 2 && diffDays <= 6) {
    return new Intl.DateTimeFormat(intlLoc, { weekday: "long" }).format(entryDate);
  }
  return new Intl.DateTimeFormat(intlLoc, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(entryDate);
}

type EntryDateGroup = {
  dateKey: string;
  label: string;
  entries: Entry[];
};

function groupFilteredEntriesByLocalDate(
  entries: Entry[],
  referenceNow: Date,
  intlLoc: string,
  todayLabel: string,
  yesterdayLabel: string,
): EntryDateGroup[] {
  const groups: EntryDateGroup[] = [];
  for (const entry of entries) {
    const dateKey = formatLocalYmd(startOfLocalDay(new Date(entry.created_at)));
    const label = formatEntryDateGroupLabel(
      entry.created_at,
      referenceNow,
      intlLoc,
      todayLabel,
      yesterdayLabel,
    );
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) {
      last.entries.push(entry);
    } else {
      groups.push({ dateKey, label, entries: [entry] });
    }
  }
  return groups;
}

const ENTRY_LONG_PRESS_MS = 500;
const ENTRY_LONG_PRESS_MOVE_PX = 10;

const CHAT_SIDEBAR_SWIPE_CLOSE_PX = 50;
const CHAT_SIDEBAR_SWIPE_LOCK_PX = 12;

function isEntryLongPressIgnoredTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) {
    return false;
  }
  return Boolean(
    el.closest(
      "button, a, input, select, textarea, label, [data-entry-longpress-ignore]",
    ),
  );
}

function formatShortThreadDate(iso: string, intlLoc: string): string {
  return new Intl.DateTimeFormat(intlLoc, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export default function Home() {
  const { t, locale } = useI18n();
  const intlLoc = intlLocaleForUi(locale);

  const entryCategoryUiLabel = useCallback(
    (category: string) => {
      const c = category.trim().toLowerCase();
      if (isKnownCategory(c)) {
        return categoryLabelForLocale(c, locale);
      }
      return categoryDisplayLabel(category);
    },
    [locale],
  );

  const [text, setText] = useState("");
  const [newEntryCategorySelection, setNewEntryCategorySelection] =
    useState<NewEntryCategorySelection>("auto");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | KnownCategory>("all");
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechErrorMessage, setSpeechErrorMessage] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingCategory, setEditingCategory] = useState<string>("other");
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingTagInput, setEditingTagInput] = useState("");
  const [isUpdatingEntry, setIsUpdatingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [selectedExportCategories, setSelectedExportCategories] = useState<KnownCategory[]>(
    ALL_CATEGORIES,
  );
  const [copyFeedback, setCopyFeedback] = useState("");
  const [saveNoticeMessage, setSaveNoticeMessage] = useState("");
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveRetryDraft, setSaveRetryDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"entries" | "chat">("entries");
  const [chatThreads, setChatThreads] = useState<ChatThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatMessage[]>([]);
  const [chatThreadsLoading, setChatThreadsLoading] = useState(false);
  const [threadMessagesLoading, setThreadMessagesLoading] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [suggestedChatQuestions, setSuggestedChatQuestions] = useState<string[]>([]);
  /** True while suggested-questions fetch is in flight (subtle skeleton only; never blocks input). */
  const [suggestionsFetchPending, setSuggestionsFetchPending] = useState(false);
  const [suggestionsReveal, setSuggestionsReveal] = useState(false);
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
  const [clockTickMs, setClockTickMs] = useState(() => Date.now());
  const [entriesSelectMode, setEntriesSelectMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(() => new Set());
  const [speechRecognitionCtor, setSpeechRecognitionCtor] =
    useState<SpeechRecognitionConstructor | null>(null);
  const isSpeechSupported = speechRecognitionCtor !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  /** When true, recognition `onend` skips committing transcript (e.g. save stopped the mic). */
  const speechDiscardCommitRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatStreamAbortRef = useRef<AbortController | null>(null);
  const suggestedQuestionsAbortRef = useRef<AbortController | null>(null);
  const chatInputSuggestionGateRef = useRef("");
  const threadMessagesLenSuggestionRef = useRef(0);
  const optimisticEntryIdRef = useRef(0);
  const chatComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatThreadsAsideInnerRef = useRef<HTMLDivElement | null>(null);
  const chatThreadsListRef = useRef<HTMLUListElement | null>(null);
  const chatSidebarOpenRef = useRef(false);
  const chatSidebarDragPxRef = useRef(0);
  const chatSidebarSwipeRef = useRef<{
    startX: number;
    startY: number;
    lock: "none" | "h" | "v";
  }>({ startX: 0, startY: 0, lock: "none" });
  const [chatSidebarDragPx, setChatSidebarDragPx] = useState(0);
  const [sidebarSwipeDragging, setSidebarSwipeDragging] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const entryLongPressRef = useRef<{
    entryId: number | null;
    timerId: ReturnType<typeof setTimeout> | null;
    completed: boolean;
    startX: number;
    startY: number;
    pointerId: number | null;
  }>({
    entryId: null,
    timerId: null,
    completed: false,
    startX: 0,
    startY: 0,
    pointerId: null,
  });
  const [pressingEntryId, setPressingEntryId] = useState<number | null>(null);
  const suppressNextEntryRowClickRef = useRef(false);
  /** Once true in the current select-mode session, auto-exit when selection becomes empty. */
  const bulkSelectHadSelectionRef = useRef(false);

  chatInputSuggestionGateRef.current = chatInput;
  threadMessagesLenSuggestionRef.current = threadMessages.length;

  const statsCategoryRows = useMemo(() => {
    const counts: Record<KnownCategory, number> = {
      health: 0,
      relationships: 0,
      career: 0,
      logistics: 0,
      finance: 0,
      emotional: 0,
      other: 0,
    };
    let legacyCount = 0;
    for (const entry of entries) {
      const c = entry.category.trim().toLowerCase();
      if (isKnownCategory(c)) {
        counts[c] += 1;
      } else {
        legacyCount += 1;
      }
    }
    const rows: { key: string; label: string; count: number; barClass: string }[] =
      ALL_CATEGORIES.map((category) => ({
        key: category,
        label: categoryLabelForLocale(category, locale),
        count: counts[category],
        barClass: categoryBarFillClass(category),
      }));
    if (legacyCount > 0) {
      rows.push({
        key: "legacy",
        label: t("common.olderCategories"),
        count: legacyCount,
        barClass: categoryBarFillClass("other"),
      });
    }
    return rows.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label);
    });
  }, [entries, locale, t]);

  const tagFrequencyList = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      for (const t of entry.tags) {
        const k = t.trim();
        if (!k) {
          continue;
        }
        map.set(k, (map.get(k) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [entries]);

  const tagAutocompletePool = useMemo(() => {
    const ordered = tagFrequencyList.map(({ tag }) => tag);
    const set = new Set(ordered);
    for (const entry of entries) {
      for (const t of entry.tags) {
        const k = t.trim();
        if (k && !set.has(k)) {
          set.add(k);
          ordered.push(k);
        }
      }
    }
    return ordered;
  }, [entries, tagFrequencyList]);

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
        entry.text.toLowerCase().includes(normalizedSearch) ||
        entry.tags.some((t) => {
          const tl = t.toLowerCase();
          return tl.includes(normalizedSearch) || tl === normalizedSearch;
        });
      const matchesCategory = entryMatchesKnownCategoryFilter(entry.category, activeCategory);
      const matchesTag = entryMatchesSelectedTags(entry.tags, activeTagFilters);
      return matchesSearch && matchesCategory && matchesTag;
    });
  }, [entries, searchQuery, activeCategory, activeTagFilters]);

  const selectableFilteredEntries = useMemo(
    () => filteredEntries.filter((e) => !e.pending),
    [filteredEntries],
  );

  const groupedFilteredEntries = useMemo(
    () =>
      groupFilteredEntriesByLocalDate(
        filteredEntries,
        new Date(clockTickMs),
        intlLoc,
        t("common.today"),
        t("common.yesterday"),
      ),
    [filteredEntries, clockTickMs, intlLoc, t],
  );

  const greetingLine = useMemo(() => {
    if (!session?.user) {
      return t("common.welcome");
    }
    return greetingLineForUser(session.user);
  }, [session, t]);

  const toggleTagFilter = useCallback((tag: string) => {
    setActiveTagFilters((prev) => {
      const lower = tag.toLowerCase();
      const has = prev.some((x) => x.toLowerCase() === lower);
      if (has) {
        return prev.filter((x) => x.toLowerCase() !== lower);
      }
      return [...prev, tag];
    });
  }, []);

  const isFilterActive =
    searchQuery.trim().length > 0 ||
    activeCategory !== "all" ||
    activeTagFilters.length > 0;

  function mapChatApiError(message: string): string {
    const map: Record<string, string> = {
      Unauthorized: "common.chatUnauthorized",
      "Thread not found.": "common.chatThreadNotFound",
      "Could not save message.": "common.chatSaveMessageFailed",
      "Assistant request failed.": "common.chatAssistantFailed",
      "Could not load history.": "common.chatCouldNotLoadHistory",
      "Could not save reply.": "common.chatCouldNotSaveReply",
      "Server configuration error.": "common.chatServerConfig",
      "Something went wrong.": "common.chatGenericError",
      "Assistant response invalid.": "common.chatAssistantFailed",
    };
    const key = map[message];
    return key ? t(key) : message;
  }

  const loadEntries = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[entries] load failed:", error.message, error);
      setErrorMessage(t("common.couldNotLoadEntries"));
      if (!silent) {
        setIsLoading(false);
      }
      return;
    }

    const normalizedEntries: Entry[] = (data ?? []).map((row) => {
      const entry = row as Record<string, unknown>;
      return {
        id: Number(entry.id),
        text: String(entry.text ?? ""),
        created_at: String(entry.created_at ?? ""),
        category: String(entry.category ?? "other").trim().toLowerCase(),
        tags: normalizeTagList(entry.tags),
      };
    });

    setEntries(normalizedEntries);
    if (!silent) {
      setIsLoading(false);
    }
  }, [t]);

  const loadChatThreads = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setChatThreadsLoading(true);
    }
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, title, updated_at, created_at")
      .order("updated_at", { ascending: false });
    if (error) {
      setChatThreads([]);
      if (!silent) {
        setChatThreadsLoading(false);
      }
      return;
    }
    setChatThreads((data ?? []) as ChatThreadRow[]);
    if (!silent) {
      setChatThreadsLoading(false);
    }
  }, []);

  const fetchThreadMessagesForId = useCallback(async (threadId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setThreadMessagesLoading(true);
    }
    const { data, error } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (error) {
      if (activeThreadIdRef.current === threadId) {
        setThreadMessages([]);
      }
      if (!silent) {
        setThreadMessagesLoading(false);
      }
      return;
    }
    const mapped: ChatMessage[] = (data ?? [])
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => ({
        role: row.role as "user" | "assistant",
        content: String(row.content ?? ""),
      }));
    if (activeThreadIdRef.current !== threadId) {
      if (!silent) {
        setThreadMessagesLoading(false);
      }
      return;
    }
    setThreadMessages(mapped);
    if (!silent) {
      setThreadMessagesLoading(false);
    }
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
        setStatsExpanded(readStatsExpandedPreference());
        setNewEntryCategorySelection(
          readDefaultCategoryPreference() as NewEntryCategorySelection,
        );
      } catch {
        // ignore private mode / quota
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [isMounted]);

  useEffect(() => {
    if (activeTab !== "entries" || !isMounted) {
      return;
    }
    const timeoutId = setTimeout(() => {
      try {
        setStatsExpanded(readStatsExpandedPreference());
        setNewEntryCategorySelection(
          readDefaultCategoryPreference() as NewEntryCategorySelection,
        );
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [activeTab, isMounted]);

  useEffect(() => {
    if (!entriesSelectMode) {
      return;
    }
    if (selectedEntryIds.size > 0) {
      bulkSelectHadSelectionRef.current = true;
      return;
    }
    if (bulkSelectHadSelectionRef.current) {
      bulkSelectHadSelectionRef.current = false;
      suppressNextEntryRowClickRef.current = false;
      setEntriesSelectMode(false);
    }
  }, [entriesSelectMode, selectedEntryIds]);

  useEffect(() => {
    function resetForSignedOut() {
      setEntries([]);
      setChatThreads([]);
      setActiveThreadId(null);
      setThreadMessages([]);
      setChatInput("");
      setChatError(null);
      setChatSidebarOpen(false);
      setIsLoading(false);
      setEditingEntryId(null);
      setEditingText("");
      setEditingCategory("other");
      setEditingTags([]);
      setEditingTagInput("");
      setActiveTagFilters([]);
      setActiveCategory("all");
      setSearchQuery("");
      setSaveNoticeMessage("");
      setSaveRetryDraft(null);
      setSuggestedChatQuestions([]);
      setSuggestionsFetchPending(false);
      bulkSelectHadSelectionRef.current = false;
      suppressNextEntryRowClickRef.current = false;
      setEntriesSelectMode(false);
      setSelectedEntryIds(new Set());
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
    const mq = window.matchMedia("(max-width: 1023px)");
    const timeoutId = setTimeout(() => {
      setIsMobileViewport(mq.matches);
    }, 0);
    const onChange = () => setIsMobileViewport(mq.matches);
    mq.addEventListener("change", onChange);
    return () => {
      clearTimeout(timeoutId);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    chatSidebarOpenRef.current = chatSidebarOpen;
    chatSidebarDragPxRef.current = chatSidebarDragPx;
  }, [chatSidebarOpen, chatSidebarDragPx]);

  useEffect(() => {
    if (!chatSidebarOpen) {
      chatSidebarDragPxRef.current = 0;
      const t = setTimeout(() => {
        setChatSidebarDragPx(0);
        setSidebarSwipeDragging(false);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [chatSidebarOpen]);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }
    const el = chatThreadsAsideInnerRef.current;
    if (!el) {
      return;
    }

    const isPointerMobile = () => window.matchMedia("(max-width: 1023px)").matches;

    function onTouchStart(e: TouchEvent) {
      if (!isPointerMobile() || !chatSidebarOpenRef.current) {
        return;
      }
      const t = e.touches[0];
      if (!t) {
        return;
      }
      chatSidebarSwipeRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        lock: "none",
      };
    }

    function onTouchMove(e: TouchEvent) {
      if (!isPointerMobile() || !chatSidebarOpenRef.current) {
        return;
      }
      const t = e.touches[0];
      if (!t) {
        return;
      }
      const s = chatSidebarSwipeRef.current;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      if (s.lock === "none") {
        if (
          Math.abs(dx) < CHAT_SIDEBAR_SWIPE_LOCK_PX &&
          Math.abs(dy) < CHAT_SIDEBAR_SWIPE_LOCK_PX
        ) {
          return;
        }
        s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (s.lock !== "h") {
        return;
      }

      e.preventDefault();
      const drag = Math.min(0, dx);
      chatSidebarDragPxRef.current = drag;
      setChatSidebarDragPx(drag);
      setSidebarSwipeDragging(true);
    }

    function onTouchEnd() {
      if (!isPointerMobile()) {
        chatSidebarSwipeRef.current = { startX: 0, startY: 0, lock: "none" };
        return;
      }
      const s = chatSidebarSwipeRef.current;
      if (s.lock === "h" && chatSidebarDragPxRef.current < -CHAT_SIDEBAR_SWIPE_CLOSE_PX) {
        setChatSidebarOpen(false);
      }
      chatSidebarDragPxRef.current = 0;
      setChatSidebarDragPx(0);
      setSidebarSwipeDragging(false);
      chatSidebarSwipeRef.current = { startX: 0, startY: 0, lock: "none" };
    }

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", onTouchEnd, { capture: true });
      el.removeEventListener("touchcancel", onTouchEnd, { capture: true });
    };
  }, [activeTab]);

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
    if (activeTab !== "chat") {
      return;
    }
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth",
        });
      });
    });
  }, [threadMessages, isChatSending, activeTab]);

  useEffect(() => {
    if (activeTab !== "chat" || !session) {
      return;
    }
    queueMicrotask(() => {
      void loadChatThreads();
    });
  }, [activeTab, session, loadChatThreads]);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }
    if (activeThreadId != null) {
      return;
    }
    if (chatThreads.length === 0) {
      return;
    }
    const nextId = chatThreads[0].id;
    queueMicrotask(() => {
      setActiveThreadId(nextId);
    });
  }, [activeTab, activeThreadId, chatThreads]);

  useEffect(() => {
    if (activeTab !== "chat" || !activeThreadId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      await fetchThreadMessagesForId(activeThreadId, { silent: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeThreadId, fetchThreadMessagesForId]);

  useEffect(() => {
    const id = window.setInterval(() => setClockTickMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (
      activeTab !== "chat" ||
      !activeThreadId ||
      threadMessages.length > 0 ||
      threadMessagesLoading ||
      isChatSending ||
      entries.length === 0 ||
      chatInput.trim().length > 0
    ) {
      return;
    }

    const threadIdAtStart = activeThreadId;
    const ac = new AbortController();
    suggestedQuestionsAbortRef.current?.abort();
    suggestedQuestionsAbortRef.current = ac;

    setSuggestionsFetchPending(true);
    setSuggestedChatQuestions([]);
    setSuggestionsReveal(false);

    void (async () => {
      try {
        const res = await fetch("/api/suggested-questions", {
          method: "POST",
          credentials: "same-origin",
          signal: ac.signal,
        });
        const data = (await res.json()) as { questions?: unknown };
        const raw = Array.isArray(data.questions) ? data.questions : [];
        const qs = raw
          .filter((q): q is string => typeof q === "string")
          .map((q) => q.trim())
          .filter((q) => q.length > 0)
          .slice(0, 6);

        if (ac.signal.aborted) {
          return;
        }
        if (activeThreadIdRef.current !== threadIdAtStart) {
          return;
        }
        if (chatInputSuggestionGateRef.current.trim().length > 0) {
          return;
        }
        if (threadMessagesLenSuggestionRef.current > 0) {
          return;
        }

        setSuggestedChatQuestions(qs);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
      } finally {
        if (!ac.signal.aborted) {
          setSuggestionsFetchPending(false);
        }
      }
    })();

    return () => {
      ac.abort();
      setSuggestionsFetchPending(false);
    };
  }, [
    activeTab,
    activeThreadId,
    threadMessages.length,
    threadMessagesLoading,
    isChatSending,
    entries.length,
    chatInput,
  ]);

  useEffect(() => {
    if (suggestedChatQuestions.length === 0) {
      setSuggestionsReveal(false);
      return;
    }
    const id = requestAnimationFrame(() => setSuggestionsReveal(true));
    return () => cancelAnimationFrame(id);
  }, [suggestedChatQuestions]);

  function adjustChatComposerHeight() {
    const el = chatComposerRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`;
  }

  async function createNewChatThread() {
    setChatError(null);
    const { data, error } = await supabase.from("chat_threads").insert({}).select("id, title, updated_at, created_at").single();
    if (error || !data) {
      setChatError(t("common.couldNotCreateChat"));
      return;
    }
    suggestedQuestionsAbortRef.current?.abort();
    setSuggestedChatQuestions([]);
    setSuggestionsFetchPending(false);
    setSuggestionsReveal(false);
    setChatSidebarOpen(false);
    setActiveThreadId(data.id);
    setThreadMessages([]);
    await loadChatThreads();
  }

  async function handleDeleteChatThread(threadId: string) {
    const confirmed = window.confirm(t("common.deleteChatQ"));
    if (!confirmed) {
      return;
    }
    setChatError(null);
    const { error } = await supabase.from("chat_threads").delete().eq("id", threadId);
    if (error) {
      setChatError(t("common.couldNotDeleteChat"));
      return;
    }
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setThreadMessages([]);
    }
    await loadChatThreads();
  }

  /** Remove optimistic user + assistant pair after a failed streaming chat. */
  function revertOptimisticChatPair(userContent: string) {
    setThreadMessages((prev) => {
      if (prev.length < 2) {
        return prev;
      }
      const assistant = prev[prev.length - 1];
      const userMsg = prev[prev.length - 2];
      if (
        userMsg?.role === "user" &&
        userMsg.content === userContent &&
        assistant?.role === "assistant"
      ) {
        return prev.slice(0, -2);
      }
      return prev;
    });
  }

  function mapDbRowToEntry(row: Record<string, unknown>): Entry {
    return {
      id: Number(row.id),
      text: String(row.text ?? ""),
      created_at: String(row.created_at ?? ""),
      category: String(row.category ?? "other").trim().toLowerCase(),
      tags: normalizeTagList(row.tags),
    };
  }

  function allocateOptimisticEntryId(): number {
    optimisticEntryIdRef.current -= 1;
    return optimisticEntryIdRef.current;
  }

  async function handleChatSubmit(event?: FormEvent<HTMLFormElement>, presetMessage?: string) {
    event?.preventDefault();
    const trimmed = (presetMessage ?? chatInput).trim();
    if (!trimmed || isChatSending || entries.length === 0 || !activeThreadId) {
      return;
    }

    suggestedQuestionsAbortRef.current?.abort();
    setSuggestionsFetchPending(false);

    const ac = new AbortController();
    const previous = chatStreamAbortRef.current;
    chatStreamAbortRef.current = ac;
    previous?.abort();

    setChatInput("");
    const textarea = chatComposerRef.current;
    if (textarea) {
      textarea.style.height = "auto";
    }

    setChatError(null);
    setThreadMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);
    setIsChatSending(true);

    queueMicrotask(() => {
      chatComposerRef.current?.focus();
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        signal: ac.signal,
        body: JSON.stringify({
          thread_id: activeThreadId,
          message: trimmed,
        }),
      });

      if (response.status === 401) {
        setChatError(t("common.sessionExpired"));
        revertOptimisticChatPair(trimmed);
        setChatInput(trimmed);
        return;
      }

      if (!response.ok) {
        let errMsg = t("common.chatErrorFallback");
        try {
          const j = (await response.json()) as { error?: string };
          if (typeof j.error === "string") {
            errMsg = mapChatApiError(j.error);
          }
        } catch {
          // ignore
        }
        setChatError(errMsg);
        revertOptimisticChatPair(trimmed);
        setChatInput(trimmed);
        return;
      }

      const ct = response.headers.get("content-type") ?? "";
      if (!response.body || !ct.includes("ndjson")) {
        setChatError(t("common.chatErrorFallback"));
        revertOptimisticChatPair(trimmed);
        setChatInput(trimmed);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamFailed = false;

      const applyLine = (line: string) => {
        const s = line.trim();
        if (!s) {
          return;
        }
        type Nd = { type?: string; text?: string; message?: string };
        let obj: Nd;
        try {
          obj = JSON.parse(s) as Nd;
        } catch {
          return;
        }
        if (obj.type === "delta" && typeof obj.text === "string") {
          setThreadMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: last.content + obj.text,
              };
            }
            return next;
          });
        } else if (obj.type === "error") {
          streamFailed = true;
          const msg =
            typeof obj.message === "string"
              ? mapChatApiError(obj.message)
              : t("common.chatErrorFallback");
          setChatError(msg);
          revertOptimisticChatPair(trimmed);
          setChatInput(trimmed);
        } else if (obj.type === "done") {
          void loadChatThreads({ silent: true });
          const tid = activeThreadIdRef.current;
          if (tid) {
            void fetchThreadMessagesForId(tid, { silent: true });
          }
        }
      };

      while (!streamFailed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          applyLine(line);
          if (streamFailed) {
            break;
          }
        }
      }
      if (!streamFailed && buffer.trim()) {
        applyLine(buffer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setChatError(t("common.networkError"));
      revertOptimisticChatPair(trimmed);
      setChatInput(trimmed);
    } finally {
      if (chatStreamAbortRef.current === ac) {
        setIsChatSending(false);
        chatStreamAbortRef.current = null;
      }
      queueMicrotask(() => {
        chatComposerRef.current?.focus();
      });
    }
  }

  function handleSuggestedQuestion(question: string) {
    suggestedQuestionsAbortRef.current?.abort();
    setSuggestionsFetchPending(false);
    void handleChatSubmit(undefined, question);
  }

  function clearEntryLongPressTimerOnly() {
    const s = entryLongPressRef.current;
    if (s.timerId !== null) {
      clearTimeout(s.timerId);
      s.timerId = null;
    }
  }

  function resetEntryLongPressTracking() {
    clearEntryLongPressTimerOnly();
    entryLongPressRef.current.entryId = null;
    entryLongPressRef.current.completed = false;
    entryLongPressRef.current.pointerId = null;
    setPressingEntryId(null);
  }

  function handleEntryLongPressPointerDown(
    event: ReactPointerEvent<HTMLLIElement>,
    entry: Entry,
  ) {
    if (entriesSelectMode) {
      return;
    }
    if (entry.pending) {
      return;
    }
    if (editingEntryId === entry.id) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (isEntryLongPressIgnoredTarget(event.target)) {
      return;
    }

    resetEntryLongPressTracking();

    entryLongPressRef.current.entryId = entry.id;
    entryLongPressRef.current.completed = false;
    entryLongPressRef.current.startX = event.clientX;
    entryLongPressRef.current.startY = event.clientY;
    entryLongPressRef.current.pointerId = event.pointerId;

    setPressingEntryId(entry.id);

    const timerId = setTimeout(() => {
      entryLongPressRef.current.timerId = null;
      entryLongPressRef.current.completed = true;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(40);
        }
      } catch {
        // ignore
      }
      suppressNextEntryRowClickRef.current = true;
      setEntriesSelectMode(true);
      setSelectedEntryIds(new Set([entry.id]));
    }, ENTRY_LONG_PRESS_MS);
    entryLongPressRef.current.timerId = timerId;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function handleEntryLongPressPointerMove(
    event: ReactPointerEvent<HTMLLIElement>,
    entry: Entry,
  ) {
    if (entriesSelectMode) {
      return;
    }
    const s = entryLongPressRef.current;
    if (s.entryId !== entry.id || s.completed || s.pointerId !== event.pointerId) {
      return;
    }
    const dx = Math.abs(event.clientX - s.startX);
    const dy = Math.abs(event.clientY - s.startY);
    if (dx > ENTRY_LONG_PRESS_MOVE_PX || dy > ENTRY_LONG_PRESS_MOVE_PX) {
      clearEntryLongPressTimerOnly();
      entryLongPressRef.current.entryId = null;
      entryLongPressRef.current.completed = false;
      entryLongPressRef.current.pointerId = null;
      setPressingEntryId(null);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore
      }
    }
  }

  function handleEntryLongPressPointerEnd(
    event: ReactPointerEvent<HTMLLIElement>,
    entry: Entry,
  ) {
    const s = entryLongPressRef.current;
    if (s.entryId !== entry.id || s.pointerId !== event.pointerId) {
      return;
    }

    clearEntryLongPressTimerOnly();
    entryLongPressRef.current.entryId = null;
    entryLongPressRef.current.completed = false;
    entryLongPressRef.current.pointerId = null;
    setPressingEntryId(null);

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
  }

  function handleEntryLongPressPointerLeave(
    event: ReactPointerEvent<HTMLLIElement>,
    entry: Entry,
  ) {
    const s = entryLongPressRef.current;
    if (s.entryId !== entry.id || s.pointerId !== event.pointerId || s.completed) {
      return;
    }
    if (event.pointerType !== "mouse") {
      return;
    }
    clearEntryLongPressTimerOnly();
    entryLongPressRef.current.entryId = null;
    entryLongPressRef.current.completed = false;
    entryLongPressRef.current.pointerId = null;
    setPressingEntryId(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
  }

  function toggleEntrySelected(entryId: number) {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  function handleEntryRowSelectClick(entry: Entry) {
    if (entry.pending) {
      return;
    }
    if (suppressNextEntryRowClickRef.current) {
      suppressNextEntryRowClickRef.current = false;
      return;
    }
    toggleEntrySelected(entry.id);
  }

  function handleTabChange(tab: "entries" | "chat") {
    if (tab !== "entries") {
      suppressNextEntryRowClickRef.current = false;
      bulkSelectHadSelectionRef.current = false;
      setEntriesSelectMode(false);
      setSelectedEntryIds(new Set());
    }
    setActiveTab(tab);
  }

  function handleToggleEntriesSelectMode() {
    if (!entriesSelectMode) {
      setEditingEntryId(null);
      setEditingText("");
      setEditingCategory("other");
      setIsUpdatingEntry(false);
      bulkSelectHadSelectionRef.current = false;
      setEntriesSelectMode(true);
      return;
    }
    suppressNextEntryRowClickRef.current = false;
    bulkSelectHadSelectionRef.current = false;
    setSelectedEntryIds(new Set());
    setEntriesSelectMode(false);
  }

  const allFilteredSelected =
    selectableFilteredEntries.length > 0 &&
    selectableFilteredEntries.every((e) => selectedEntryIds.has(e.id));

  function handleSelectAllFiltered() {
    setSelectedEntryIds(new Set(selectableFilteredEntries.map((e) => e.id)));
  }

  function handleDeselectAllFiltered() {
    setSelectedEntryIds(new Set());
  }

  async function handleBulkDeleteSelected() {
    const ids = [...selectedEntryIds].filter((id) => id > 0);
    if (ids.length === 0) {
      return;
    }
    const confirmed = window.confirm(t("common.bulkDeleteIrreversible", { count: ids.length }));
    if (!confirmed) {
      return;
    }
    setErrorMessage(null);
    const { error } = await supabase.from("entries").delete().in("id", ids);
    if (error) {
      setErrorMessage(t("common.settingsCouldNotDeleteEntries"));
      await loadEntries({ silent: true });
      return;
    }
    suppressNextEntryRowClickRef.current = false;
    bulkSelectHadSelectionRef.current = false;
    setSelectedEntryIds(new Set());
    setEntriesSelectMode(false);
    await loadEntries({ silent: true });
  }

  async function handleLogout() {
    setAuthBusy(true);
    setAuthError(null);
    await supabase.auth.signOut();
    setAuthBusy(false);
  }

  function clearPasswordMismatchIfNeeded() {
    setAuthError((previous) =>
      previous === t("common.authPasswordsMismatch") ? null : previous,
    );
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthNotice(null);

    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) {
      setAuthError(t("common.authEnterEmailPassword"));
      return;
    }

    if (authMode === "signUp") {
      if (password !== authConfirmPassword) {
        setAuthError(t("common.authPasswordsMismatch"));
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
          setAuthNotice(t("common.authConfirmEmail"));
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
      setAuthError(t("common.authEnterEmail"));
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
      setAuthNotice(t("common.authResetSent"));
    } finally {
      setAuthBusy(false);
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
    recognition.lang = speechRecognitionLang(locale);
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
        setSpeechErrorMessage(t("common.micDenied"));
      } else {
        setSpeechErrorMessage(t("common.voiceFailed"));
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
    if (!trimmedText) {
      return;
    }

    const useAutoCategory = newEntryCategorySelection === "auto";
    const manualCategorySnapshot = newEntryCategorySelection;
    const tempId = allocateOptimisticEntryId();
    const optimisticCategorySlug: string = useAutoCategory
      ? "other"
      : manualCategorySnapshot;

    setErrorMessage(null);
    setSaveRetryDraft(null);
    stopListening({ discardPendingCommit: true });

    const optimisticEntry: Entry = {
      id: tempId,
      text: trimmedText,
      created_at: new Date().toISOString(),
      category: optimisticCategorySlug,
      tags: [],
      pending: true,
    };
    setEntries((prev) => [optimisticEntry, ...prev]);
    setText("");
    setNewEntryCategorySelection("auto");

    void (async () => {
      let processedEntries: Array<{ text: string; category: KnownCategory; tags: string[] }> = [
        { text: trimmedText, category: "other", tags: [] },
      ];

      try {
        const processResponse = await fetch("/api/process", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: trimmedText,
            manualCategory: manualCategorySnapshot,
          }),
        });

        if (processResponse.status === 401) {
          setEntries((prev) => prev.filter((e) => e.id !== tempId));
          setErrorMessage(t("common.sessionExpired"));
          setText(trimmedText);
          setSaveRetryDraft(trimmedText);
          return;
        }

        if (!processResponse.ok) {
          const errText = await processResponse.text().catch(() => "");
          console.error(
            "[entries save] /api/process HTTP error",
            processResponse.status,
            errText.slice(0, 500),
          );
        }

        if (processResponse.ok) {
          let result: {
            acknowledgment?: string;
            entries?: ProcessApiEntry[];
          };
          try {
            result = (await processResponse.json()) as {
              acknowledgment?: string;
              entries?: ProcessApiEntry[];
            };
          } catch (parseErr) {
            console.error("[entries save] invalid JSON from /api/process", parseErr);
            result = {};
          }

          let mappedEntries: Array<{ text: string; category: KnownCategory; tags: string[] }> = [];
          try {
            mappedEntries =
              result.entries
                ?.map((entry) => ({
                  text: entry.text?.trim() ?? "",
                  category: sanitizeCategoryForStorage(entry.category),
                  tags: normalizeTagList(entry.tags),
                }))
                .filter((entry) => entry.text.length > 0) ?? [];
          } catch (mapErr) {
            console.error("[entries save] failed to map process entries (tags/categories)", mapErr);
            mappedEntries = [];
          }

          if (mappedEntries.length > 0) {
            processedEntries = mappedEntries;
          }
        }
      } catch (err) {
        console.error("[entries save] /api/process request failed — inserting fallback rows:", err);
        if (manualCategorySnapshot !== "auto") {
          processedEntries = [
            { text: trimmedText, category: manualCategorySnapshot, tags: [] },
          ];
        }
      }

      const insertedRows: Entry[] = [];

      for (const entry of processedEntries) {
        const insertPayload = {
          text: entry.text,
          category: entry.category,
          tags: entry.tags,
        };

        let ins = await supabase.from("entries").insert(insertPayload).select("*").single();

        if (ins.error) {
          console.warn("[entries save] first insert error:", ins.error.message, ins.error.code);
        }

        if (ins.error && isMissingTagsColumnError(ins.error)) {
          ins = await supabase
            .from("entries")
            .insert({
              text: entry.text,
              category: entry.category,
            })
            .select("*")
            .single();
        }

        if (ins.error || !ins.data) {
          setEntries((prev) => prev.filter((e) => e.id !== tempId));
          setErrorMessage(t("common.couldNotSaveEntry"));
          setSaveRetryDraft(trimmedText);
          return;
        }

        insertedRows.push(mapDbRowToEntry(ins.data as Record<string, unknown>));
      }

      setEntries((prev) => {
        const rest = prev.filter((e) => e.id !== tempId);
        return [...insertedRows, ...rest];
      });
    })();
  }

  function handleStartEdit(entry: Entry) {
    setErrorMessage(null);
    setEditingEntryId(entry.id);
    setEditingText(entry.text);
    setEditingCategory(entry.category);
    setEditingTags([...entry.tags]);
    setEditingTagInput("");
  }

  function handleCancelEdit() {
    setEditingEntryId(null);
    setEditingText("");
    setEditingCategory("other");
    setEditingTags([]);
    setEditingTagInput("");
    setIsUpdatingEntry(false);
  }

  function commitEditingTagFromInput() {
    const raw = editingTagInput.trim();
    if (!raw) {
      return;
    }
    const exists = editingTags.some((tag) => tag.toLowerCase() === raw.toLowerCase());
    if (exists) {
      setEditingTagInput("");
      return;
    }
    const next = normalizeTagList([...editingTags, raw]);
    setEditingTags(next);
    setEditingTagInput("");
  }

  async function handleSaveEdit(entryId: number) {
    const trimmedText = editingText.trim();
    if (!trimmedText || isUpdatingEntry) {
      return;
    }

    setIsUpdatingEntry(true);
    setErrorMessage(null);

    const categoryToSave = persistEntryCategory(editingCategory);
    const tagsToSave = normalizeTagList(editingTags);

    let error = (
      await supabase
        .from("entries")
        .update({ text: trimmedText, category: categoryToSave, tags: tagsToSave })
        .eq("id", entryId)
    ).error;
    if (error && isMissingTagsColumnError(error)) {
      ({ error } = await supabase
        .from("entries")
        .update({ text: trimmedText, category: categoryToSave })
        .eq("id", entryId));
    }

    if (error) {
      setErrorMessage(t("common.couldNotUpdateEntry"));
      setIsUpdatingEntry(false);
      return;
    }

    handleCancelEdit();
    await loadEntries({ silent: true });
  }

  async function handleDeleteEntry(entryId: number) {
    if (entryId < 0) {
      return;
    }
    const targetEntry = entries.find((e) => e.id === entryId);
    if (targetEntry?.pending) {
      return;
    }

    const confirmed = window.confirm(t("common.deleteEntryQ"));
    if (!confirmed) {
      return;
    }

    setDeletingEntryId(entryId);
    setErrorMessage(null);

    const { error } = await supabase.from("entries").delete().eq("id", entryId);

    if (error) {
      setErrorMessage(t("common.couldNotDeleteEntry"));
      setDeletingEntryId(null);
      return;
    }

    if (editingEntryId === entryId) {
      handleCancelEdit();
    }

    await loadEntries({ silent: true });
    setDeletingEntryId(null);
  }

  function toggleExportCategory(category: KnownCategory) {
    setSelectedExportCategories((previousCategories) =>
      previousCategories.includes(category)
        ? previousCategories.filter((item) => item !== category)
        : [...previousCategories, category],
    );
  }

  const exportableEntries = useMemo(() => {
    const base = exportScope === "filtered" ? filteredEntries : entries;
    const sourceEntries = base.filter((entry) => !entry.pending);

    return sourceEntries.filter((entry) => {
      const inSelected = selectedExportCategories.some((sel) =>
        entryMatchesKnownCategoryFilter(entry.category, sel),
      );
      if (!inSelected) {
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
      `# ${t("common.exportHeadingDoc")}`,
      `${t("common.generatedPrefix")} ${new Date().toLocaleString(intlLoc)}`,
      `${t("common.entryExportMetaLine")} ${entriesToExport.length}`,
      "",
    ];

    let currentDateHeading = "";
    entriesToExport.forEach((entry) => {
      const dateHeading = formatDateHeading(entry.created_at, intlLoc);
      if (dateHeading !== currentDateHeading) {
        currentDateHeading = dateHeading;
        lines.push(`## ${dateHeading}`);
      }

      lines.push(
        `- ${formatTimeOnly(entry.created_at, intlLoc)} - ${entryCategoryUiLabel(entry.category)}`,
      );
      if (entry.tags.length > 0) {
        lines.push(`${t("export.tagsPrefix")} ${entry.tags.join(", ")}`);
      }
      lines.push(`${entry.text}`, "");
    });

    return lines.join("\n").trim();
  }

  function buildTextExport(entriesToExport: Entry[]): string {
    const lines: string[] = [
      t("common.exportPlainHeading"),
      `${t("common.generatedPrefix")} ${new Date().toLocaleString(intlLoc)}`,
      `${t("common.entryExportMetaLine")} ${entriesToExport.length}`,
      "",
    ];

    let currentDateHeading = "";
    entriesToExport.forEach((entry) => {
      const dateHeading = formatDateHeading(entry.created_at, intlLoc);
      if (dateHeading !== currentDateHeading) {
        currentDateHeading = dateHeading;
        lines.push(dateHeading);
      }

      lines.push(
        `${formatTimeOnly(entry.created_at, intlLoc)} - ${entryCategoryUiLabel(entry.category)}`,
      );
      if (entry.tags.length > 0) {
        lines.push(`${t("export.tagsPrefix")} ${entry.tags.join(", ")}`);
      }
      lines.push(`${entry.text}`, "");
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
          tags: entry.tags,
        })),
        null,
        2,
      );
    }

    if (exportFormat === "text") {
      return buildTextExport(exportableEntries);
    }

    return buildMarkdownExport(exportableEntries);
  }, [exportFormat, exportableEntries, intlLoc, t, entryCategoryUiLabel]);

  async function handleCopyExport() {
    try {
      await navigator.clipboard.writeText(exportContent);
      setCopyFeedback(t("common.copied"));
      setTimeout(() => setCopyFeedback(""), 1500);
    } catch {
      setCopyFeedback(t("common.copyFailed"));
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
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("common.loading")}</p>
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
              {authView === "forgotPassword" ? t("common.forgotIntro") : t("common.signInTitle")}
            </p>
          </header>

          {authView === "forgotPassword" ? (
            <form
              onSubmit={(event) => void handleForgotPasswordSubmit(event)}
              className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="block text-sm font-medium">
                {t("common.email")}
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
                {authBusy ? t("common.pleaseWait") : t("common.sendResetEmail")}
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
                  {t("common.backToSignIn")}
                </button>
              </p>
            </form>
          ) : (
            <form
              onSubmit={(event) => void handleAuthSubmit(event)}
              className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="block text-sm font-medium">
                {t("common.email")}
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
                {t("common.password")}
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
                  {t("common.confirmPassword")}
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
                {authBusy
                  ? t("common.pleaseWait")
                  : authMode === "signUp"
                    ? t("common.createAccount")
                    : t("common.signIn")}
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
                    {t("common.forgotPassword")}
                  </button>
                </p>
              ) : null}

              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                {authMode === "signUp" ? t("common.haveAccount") : t("common.needAccount")}{" "}
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
                  {authMode === "signUp" ? t("common.signIn") : t("common.signUp")}
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
      <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-10 pt-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-4 sm:mb-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Remembrain</h1>
            <p className="text-xs font-normal text-zinc-500 dark:text-zinc-500">
              {greetingLine}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("common.captureSubtitle")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/settings"
              className="inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-zinc-300 bg-white px-3 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              aria-label={t("common.settings")}
              title={t("common.settings")}
            >
              <span className="text-base leading-none" aria-hidden>
                ⚙️
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={authBusy}
              className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("common.logOut")}
            </button>
          </div>
        </header>

        <div className="sticky top-0 z-[60] -mx-4 mb-5 border-b border-zinc-200 bg-zinc-100/95 pb-3 pt-2 backdrop-blur-md supports-[backdrop-filter]:bg-zinc-100/85 dark:border-zinc-800 dark:bg-zinc-950/95 dark:supports-[backdrop-filter]:bg-zinc-950/90 sm:-mx-6 sm:mb-6 sm:px-6 sm:pb-4 sm:pt-3">
          <div className="grid w-full grid-cols-2 gap-2 px-4 sm:gap-3 sm:px-0">
            <button
              type="button"
              onClick={() => handleTabChange("entries")}
              className={`min-h-[3rem] rounded-xl px-3 py-3 text-center text-base font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:shadow-none dark:focus-visible:ring-offset-zinc-950 sm:min-h-[3.25rem] sm:px-5 sm:text-lg ${
                activeTab === "entries"
                  ? "bg-emerald-600 text-white shadow-emerald-900/30 ring-2 ring-emerald-700/30 dark:bg-emerald-500 dark:text-white dark:ring-emerald-400/40"
                  : "border-2 border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              }`}
            >
              {t("common.entriesTab")}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("chat")}
              className={`min-h-[3rem] rounded-xl px-3 py-3 text-center text-base font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:shadow-none dark:focus-visible:ring-offset-zinc-950 sm:min-h-[3.25rem] sm:px-5 sm:text-lg ${
                activeTab === "chat"
                  ? "bg-emerald-600 text-white shadow-emerald-900/30 ring-2 ring-emerald-700/30 dark:bg-emerald-500 dark:text-white dark:ring-emerald-400/40"
                  : "border-2 border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              }`}
            >
              {t("common.chatTab")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-6">
        {activeTab === "entries" ? (
          <>
            <form
          onSubmit={handleSave}
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <label htmlFor="entry" className="mb-2 block text-sm font-medium">
            {t("common.newJournalEntry")}
          </label>
          <div className="relative">
            <textarea
              id="entry"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("common.placeholderEntry")}
              className="min-h-32 w-full resize-y rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 pr-14 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
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
                aria-label={isListening ? t("common.voiceStop") : t("common.voiceStart")}
                className={`absolute bottom-3 right-3 inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isListening
                    ? "animate-pulse bg-red-600 text-white hover:bg-red-500"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                }`}
              >
                {isListening ? t("common.listening") : t("common.mic")}
              </button>
            ) : null}
          </div>
          {speechErrorMessage ? (
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">{speechErrorMessage}</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full min-h-12 scroll-mt-4 rounded-xl bg-zinc-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-zinc-700 active:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            disabled={!text.trim()}
            aria-live="polite"
          >
            {t("common.save")}
          </button>
          <div className="mt-6 space-y-2 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <p className="text-sm font-medium">{t("common.category")}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNewEntryCategorySelection("auto")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  newEntryCategorySelection === "auto"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {t("common.auto")}
              </button>
              {ALL_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setNewEntryCategorySelection(category)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                    newEntryCategorySelection === category
                      ? categoryBadgeClass(category)
                      : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {categoryLabelForLocale(category, locale)}
                </button>
              ))}
            </div>
          </div>
        </form>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">{t("common.stats")}</h2>
            <button
              type="button"
              onClick={() => setStatsExpanded((open) => !open)}
              className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              {statsExpanded ? t("common.hideStats") : t("common.showStats")}
            </button>
          </div>
          {statsExpanded ? (
            <div className="mt-4 space-y-8">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("common.statsTotalLabel")}
                </p>
                <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
                  {entries.length}
                </p>
              </div>

              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("common.statsByCategory")}
                </p>
                <div className="space-y-2">
                  {statsCategoryRows.map(({ key, label, count, barClass }) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span className="w-[7.5rem] shrink-0 truncate text-zinc-600 dark:text-zinc-400">
                        {label}
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className={`h-full rounded-full ${barClass}`}
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
                  {t("common.statsLast30")}
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

        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("common.savedEntries")}</h2>
          {saveNoticeMessage ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
              {saveNoticeMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
              <p>{errorMessage}</p>
              {saveRetryDraft != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setText(saveRetryDraft);
                    setErrorMessage(null);
                    setSaveRetryDraft(null);
                  }}
                  className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 transition hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-200 dark:hover:bg-zinc-800"
                >
                  {t("common.retry")}
                </button>
              ) : null}
            </div>
          ) : null}
          {isLoading ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              {t("common.loadingEntries")}
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              {t("common.noEntriesYet")}
            </p>
          ) : (
            <>
              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="entry-search" className="block text-sm font-medium">
                    {t("common.searchEntries")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsExportModalOpen(true)}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  >
                    {t("common.export")}
                  </button>
                </div>
                <input
                  id="entry-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("common.searchPlaceholder")}
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
                    {t("common.all")}
                  </button>
                  {ALL_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        activeCategory === category
                          ? categoryBadgeClass(category)
                          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {categoryLabelForLocale(category, locale)}
                    </button>
                  ))}
                </div>
                {tagFrequencyList.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t("common.tagsCount", { count: tagFrequencyList.length })}
                      </p>
                      {activeTagFilters.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setActiveTagFilters([])}
                          className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                        >
                          {t("common.clearTags")}
                        </button>
                      ) : null}
                    </div>
                    <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 pt-0.5">
                      {tagFrequencyList.map(({ tag, count }) => {
                        const selected = activeTagFilters.some(
                          (s) => s.toLowerCase() === tag.toLowerCase(),
                        );
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagFilter(tag)}
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                              selected
                                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                                : "border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            }`}
                          >
                            {tag}
                            <span className="ml-1 tabular-nums opacity-80">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {t("common.showingCount", {
                    filtered: filteredEntries.length,
                    total: entries.length,
                  })}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleToggleEntriesSelectMode}
                  disabled={entries.length === 0}
                  className={`min-h-10 shrink-0 rounded-xl border-2 px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none ${
                    entriesSelectMode
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-800 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  {entriesSelectMode ? t("common.cancel") : t("common.select")}
                </button>
              </div>

              {entriesSelectMode && filteredEntries.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/80">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {t("common.selectedCount", { count: selectedEntryIds.size })}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleBulkDeleteSelected()}
                    disabled={selectedEntryIds.size === 0}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-red-700"
                  >
                    {t("common.deleteSelected")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      allFilteredSelected ? handleDeselectAllFiltered() : handleSelectAllFiltered()
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-950"
                  >
                    {allFilteredSelected ? t("common.deselectAll") : t("common.selectAll")}
                  </button>
                </div>
              ) : null}

              {filteredEntries.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                  {t("common.noEntriesMatch")}
                </p>
              ) : (
                <div className="space-y-5">
                  {groupedFilteredEntries.map((group) => (
                    <div
                      key={group.dateKey}
                      className="space-y-3"
                      role="group"
                      aria-label={`Journal entries, ${group.label}`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="h-px min-w-[0.75rem] flex-1 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
                        <span className="shrink-0 max-w-[85%] px-1 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          {group.label}
                        </span>
                        <span className="h-px min-w-[0.75rem] flex-1 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
                      </div>
                      <ul className="space-y-3">
                        {group.entries.map((entry) => (
                          <li
                            key={entry.id}
                            className={`touch-manipulation rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-transform duration-150 will-change-transform dark:border-zinc-800 dark:bg-zinc-900 ${
                              entriesSelectMode ? "cursor-pointer" : ""
                            } ${
                              pressingEntryId === entry.id
                                ? "scale-[0.985] ring-2 ring-zinc-400/90 dark:ring-zinc-500"
                                : ""
                            }`}
                            onPointerDown={(e) => handleEntryLongPressPointerDown(e, entry)}
                            onPointerMove={(e) => handleEntryLongPressPointerMove(e, entry)}
                            onPointerUp={(e) => handleEntryLongPressPointerEnd(e, entry)}
                            onPointerCancel={(e) => handleEntryLongPressPointerEnd(e, entry)}
                            onPointerLeave={(e) => handleEntryLongPressPointerLeave(e, entry)}
                            onClick={
                              entriesSelectMode
                                ? () => handleEntryRowSelectClick(entry)
                                : undefined
                            }
                          >
                            <div className="flex gap-3">
                              {entriesSelectMode ? (
                                <label
                                  className="mt-1 shrink-0 cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedEntryIds.has(entry.id)}
                                    disabled={entry.pending}
                                    onChange={() => toggleEntrySelected(entry.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-4 w-4 rounded border-zinc-400"
                                  />
                                </label>
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {formatTimestamp(entry.created_at, intlLoc)}
                                    {entry.pending ? (
                                      <span className="ml-2 font-medium text-amber-700 dark:text-amber-300">
                                        {t("common.entrySaving")}
                                      </span>
                                    ) : null}
                                  </p>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    {editingEntryId === entry.id && !entriesSelectMode ? (
                                      <select
                                        value={editingCategory}
                                        onChange={(event) =>
                                          setEditingCategory(event.target.value.trim().toLowerCase())
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                                      >
                                        {!isKnownCategory(entry.category) ? (
                                          <option value={entry.category}>
                                            {entryCategoryUiLabel(entry.category)}{" "}
                                            {t("common.categoryOlder")}
                                          </option>
                                        ) : null}
                                        {ALL_CATEGORIES.map((category) => (
                                          <option key={category} value={category}>
                                            {categoryLabelForLocale(category, locale)}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span
                                        data-entry-longpress-ignore
                                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${categoryBadgeClass(entry.category)}`}
                                      >
                                        {entryCategoryUiLabel(entry.category)}
                                      </span>
                                    )}
                                    {editingEntryId !== entry.id &&
                                    !entriesSelectMode &&
                                    Array.isArray(entry.tags) &&
                                    entry.tags.length > 0
                                      ? entry.tags.map((tag, tagIdx) => (
                                          <button
                                            key={`${entry.id}-tag-${tagIdx}-${tag.slice(0, 40)}`}
                                            type="button"
                                            data-entry-longpress-ignore
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleTagFilter(tag);
                                            }}
                                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight transition ${
                                              activeTagFilters.some(
                                                (s) => s.toLowerCase() === tag.toLowerCase(),
                                              )
                                                ? "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
                                                : "border border-zinc-200 bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                                            }`}
                                          >
                                            {typeof tag === "string" ? tag : String(tag)}
                                          </button>
                                        ))
                                      : null}
                                    {!entriesSelectMode ? (
                                      <>
                                        <button
                                          type="button"
                                          aria-label={t("common.editEntryAria")}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleStartEdit(entry);
                                          }}
                                          disabled={
                                            isUpdatingEntry ||
                                            deletingEntryId === entry.id ||
                                            entry.pending
                                          }
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={t("common.deleteEntryAria")}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDeleteEntry(entry.id);
                                          }}
                                          disabled={
                                            isUpdatingEntry ||
                                            deletingEntryId === entry.id ||
                                            entry.pending
                                          }
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                                        >
                                          {deletingEntryId === entry.id ? "…" : "🗑️"}
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                                {editingEntryId === entry.id && !entriesSelectMode ? (
                                  <>
                                    <textarea
                                      value={editingText}
                                      onChange={(event) => setEditingText(event.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-2 min-h-24 w-full resize-y rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                                    />
                                    <div
                                      className="mt-2 flex flex-wrap gap-1.5"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {editingTags.map((tag) => (
                                        <span
                                          key={tag}
                                          className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                                        >
                                          {tag}
                                          <button
                                            type="button"
                                            aria-label={`Remove tag ${tag}`}
                                            className="rounded px-0.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                                            onClick={() =>
                                              setEditingTags(editingTags.filter((t) => t !== tag))
                                            }
                                          >
                                            ×
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                    <div
                                      className="mt-2 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="text"
                                        list={`edit-tag-datalist-${entry.id}`}
                                        value={editingTagInput}
                                        onChange={(e) => setEditingTagInput(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === ",") {
                                            e.preventDefault();
                                            commitEditingTagFromInput();
                                          }
                                        }}
                                        placeholder={t("common.tagPlaceholder")}
                                        className="min-h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-600 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700 sm:max-w-xs"
                                      />
                                      <datalist id={`edit-tag-datalist-${entry.id}`}>
                                        {tagAutocompletePool
                                          .filter(
                                            (t) =>
                                              !editingTags.some(
                                                (x) => x.toLowerCase() === t.toLowerCase(),
                                              ),
                                          )
                                          .filter((t) =>
                                            editingTagInput.trim()
                                              ? t
                                                  .toLowerCase()
                                                  .includes(editingTagInput.trim().toLowerCase())
                                              : true,
                                          )
                                          .slice(0, 50)
                                          .map((t) => (
                                            <option key={t} value={t} />
                                          ))}
                                      </datalist>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleSaveEdit(entry.id);
                                        }}
                                        disabled={!editingText.trim() || isUpdatingEntry}
                                        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                      >
                                        {isUpdatingEntry ? t("common.saving") : t("common.save")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCancelEdit();
                                        }}
                                        disabled={isUpdatingEntry}
                                        className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                                      >
                                        {t("common.cancel")}
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                                      {entry.text}
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
          </>
        ) : (
          <div className="flex w-full min-w-0 flex-col gap-3 lg:min-h-[min(80vh,800px)] lg:flex-row lg:items-stretch lg:gap-4">
            {/* Right-edge dim strip (~22%): tap to close; tabs/chat peek through underneath */}
            {chatSidebarOpen ? (
              <button
                type="button"
                className="fixed inset-y-0 right-0 left-[78vw] z-[69] bg-zinc-950/40 backdrop-blur-[1px] lg:hidden"
                aria-label={t("common.closeMenu")}
                onClick={() => setChatSidebarOpen(false)}
              />
            ) : null}

            <div className="relative z-[55] flex items-center gap-2 lg:z-auto lg:hidden">
              <button
                type="button"
                onClick={() => setChatSidebarOpen(true)}
                className="min-h-11 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
              >
                {t("common.chats")}
              </button>
              <button
                type="button"
                onClick={() => void createNewChatThread()}
                className="min-h-11 flex-1 rounded-xl bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                {t("common.newChat")}
              </button>
            </div>

            {/* Slide the whole aside off-screen when closed so the fixed box does not steal taps (inner-only translate left the outer hit region in place). */}
            <aside
              className={`flex flex-col max-lg:fixed max-lg:left-0 max-lg:top-0 max-lg:bottom-0 max-lg:z-[70] max-lg:h-[100dvh] max-lg:w-[78vw] max-lg:transition-transform max-lg:duration-300 max-lg:ease-out ${
                chatSidebarOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
              } lg:static lg:z-0 lg:h-auto lg:max-h-none lg:w-[300px] lg:shrink-0 lg:translate-x-0`}
              aria-hidden={isMobileViewport && !chatSidebarOpen}
            >
              <div
                ref={chatThreadsAsideInnerRef}
                className="flex h-full max-h-screen w-full flex-col overflow-hidden border-r border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 lg:max-h-none lg:rounded-2xl lg:border lg:shadow-sm"
                style={
                  isMobileViewport &&
                  chatSidebarOpen &&
                  (sidebarSwipeDragging || chatSidebarDragPx !== 0)
                    ? {
                        transform: `translateX(${chatSidebarDragPx}px)`,
                        transition: sidebarSwipeDragging ? "none" : undefined,
                      }
                    : undefined
                }
              >
                {/* Mobile: partial overlay panel header */}
                <div className="grid shrink-0 grid-cols-[minmax(3rem,1fr)_minmax(0,auto)_minmax(3rem,1fr)] items-center gap-2 border-b border-zinc-200 px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-zinc-800 lg:hidden">
                  <button
                    type="button"
                    className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                    onClick={() => setChatSidebarOpen(false)}
                    aria-label={t("common.back")}
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      ←
                    </span>
                  </button>
                  <h2 className="pointer-events-none text-center text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {t("common.chats")}
                  </h2>
                  <button
                    type="button"
                    onClick={() => void createNewChatThread()}
                    className="justify-self-end whitespace-nowrap rounded-xl bg-zinc-900 px-3 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {t("common.newChat")}
                  </button>
                </div>

                <div className="hidden items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-800 lg:flex lg:rounded-t-2xl">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {t("common.chats")}
                  </span>
                </div>
                <div className="hidden p-2 lg:block">
                  <button
                    type="button"
                    onClick={() => void createNewChatThread()}
                    className="w-full rounded-xl border border-dashed border-zinc-300 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    {t("common.newChat")}
                  </button>
                </div>
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  <ul
                    ref={chatThreadsListRef}
                    className="flex min-h-0 flex-1 flex-col space-y-1 overflow-y-auto p-2 pt-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                  >
                {chatThreadsLoading ? (
                  <li className="px-2 text-sm text-zinc-500">{t("common.loading")}</li>
                ) : chatThreads.length === 0 ? (
                  <li className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    <p>{t("common.askRemembrain")}</p>
                    <button
                      type="button"
                      onClick={() => void createNewChatThread()}
                      className="mt-3 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {t("common.newChat")}
                    </button>
                  </li>
                ) : (
                  chatThreads.map((thread) => (
                    <li key={thread.id} className="group flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(thread.id);
                          setChatSidebarOpen(false);
                        }}
                        className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm transition ${
                          activeThreadId === thread.id
                            ? "bg-zinc-200 dark:bg-zinc-800"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                        }`}
                      >
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {thread.title?.trim() || t("common.newChatTitle")}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatShortThreadDate(thread.updated_at, intlLoc)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteChatThread(thread.id)}
                        className="shrink-0 rounded-lg p-2 text-zinc-400 opacity-100 transition hover:bg-zinc-200 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-zinc-700"
                        aria-label={t("common.deleteChatAria")}
                      >
                        🗑️
                      </button>
                    </li>
                  ))
                )}
              </ul>
                </div>
              </div>
            </aside>

            <section className="flex min-h-[min(60vh,520px)] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              {!isLoading && entries.length === 0 ? (
                <p className="shrink-0 border-b border-zinc-200 px-4 py-3 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {t("common.addEntriesBannerShort")}
                </p>
              ) : null}
              {chatError ? (
                <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                  {chatError}
                </p>
              ) : null}
              <div
                ref={chatScrollRef}
                className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 sm:px-4"
              >
                {threadMessagesLoading ? (
                  <p className="py-6 text-center text-sm text-zinc-500">{t("common.loadingMessages")}</p>
                ) : null}
                {!threadMessagesLoading &&
                !activeThreadId &&
                !chatThreadsLoading &&
                chatThreads.length === 0 &&
                entries.length === 0 ? (
                  <p className="px-2 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
                    {t("common.noEntriesForSuggestions")}
                  </p>
                ) : null}
                {!threadMessagesLoading &&
                !activeThreadId &&
                !chatThreadsLoading &&
                chatThreads.length === 0 &&
                entries.length > 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {t("common.askRemembrain")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void createNewChatThread()}
                      className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {t("common.newChat")}
                    </button>
                  </div>
                ) : null}
                {activeThreadId &&
                threadMessages.length === 0 &&
                !isChatSending &&
                !threadMessagesLoading &&
                entries.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
                    {t("common.noEntriesForSuggestions")}
                  </p>
                ) : null}
                {activeThreadId &&
                threadMessages.length === 0 &&
                !isChatSending &&
                !threadMessagesLoading &&
                entries.length > 0 ? (
                  <div className="min-h-0 shrink-0 px-2 pb-2 pt-1">
                    {suggestionsFetchPending && suggestedChatQuestions.length === 0 ? (
                      <div
                        className="mx-auto max-w-2xl space-y-2 py-2 opacity-60"
                        aria-hidden
                      >
                        <div className="h-1.5 w-[42%] max-w-[11rem] rounded-full bg-zinc-200/80 dark:bg-zinc-700/50" />
                        <div className="h-1.5 w-[30%] max-w-[8rem] rounded-full bg-zinc-200/70 dark:bg-zinc-700/40" />
                      </div>
                    ) : null}
                    {suggestedChatQuestions.length > 0 ? (
                      <div
                        className={`mx-auto grid max-w-xl grid-cols-1 gap-1.5 transition-opacity duration-300 ease-out sm:grid-cols-2 sm:gap-x-2 sm:gap-y-1.5 ${
                          suggestionsReveal ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        {suggestedChatQuestions.map((q, index) => (
                          <button
                            key={`${index}-${q.slice(0, 80)}`}
                            type="button"
                            onClick={() => handleSuggestedQuestion(q)}
                            className="rounded-full border border-zinc-200/90 bg-zinc-50/90 px-3 py-1.5 text-left text-xs leading-snug text-zinc-600 transition hover:bg-zinc-100/90 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800/80"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {threadMessages.map((message, index) => {
                  const showAssistantTypingDots =
                    message.role === "assistant" &&
                    index === threadMessages.length - 1 &&
                    isChatSending &&
                    message.content === "";

                  return (
                    <div
                      key={`chat-msg-${index}`}
                      className={`chat-message-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[min(100%,24rem)] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          message.role === "user"
                            ? "bg-blue-600 text-white dark:bg-blue-500"
                            : "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                        }`}
                      >
                        {showAssistantTypingDots ? (
                          <span
                            role="status"
                            aria-live="polite"
                            aria-label={t("common.assistantTyping")}
                            className="inline-flex items-center gap-1.5"
                          >
                            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-300" />
                            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-300" />
                            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-300" />
                          </span>
                        ) : (
                          message.content
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <form
                onSubmit={(event) => void handleChatSubmit(event)}
                className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-end"
              >
                <textarea
                  ref={chatComposerRef}
                  rows={1}
                  value={chatInput}
                  onChange={(event) => {
                    setChatInput(event.target.value);
                    if (chatError) {
                      setChatError(null);
                    }
                    requestAnimationFrame(adjustChatComposerHeight);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleChatSubmit();
                    }
                  }}
                  placeholder={
                    !isLoading && entries.length === 0
                      ? t("common.chatPlaceholderEntriesFirst")
                      : t("common.askPlaceholder")
                  }
                  disabled={isLoading || entries.length === 0 || !activeThreadId}
                  className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                />
                <button
                  type="submit"
                  disabled={
                    isChatSending ||
                    !chatInput.trim() ||
                    isLoading ||
                    entries.length === 0 ||
                    !activeThreadId
                  }
                  className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:w-auto sm:self-stretch sm:px-6"
                >
                  {t("common.send")}
                </button>
              </form>
            </section>
          </div>
        )}
        </div>
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
              <h3 className="text-base font-semibold">{t("common.exportTitle")}</h3>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                aria-label={t("common.closeExportModal")}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("common.formatLabel")}</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "markdown" as const, label: t("common.markdownExport") },
                    { id: "text" as const, label: t("common.plainExport") },
                    { id: "json" as const, label: t("common.jsonExport") },
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
                <p className="text-sm font-medium">{t("common.scopeLabel")}</p>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="export-scope"
                      value="all"
                      checked={exportScope === "all"}
                      onChange={() => setExportScope("all")}
                    />
                    {t("common.scopeAll")}
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
                      {t("common.scopeFiltered")}
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
                    {t("common.scopeDateRange")}
                  </label>
                </div>
                {exportScope === "date-range" ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs">
                      {t("common.startDate")}
                      <input
                        type="date"
                        value={exportStartDate}
                        onChange={(event) => setExportStartDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                      />
                    </label>
                    <label className="text-xs">
                      {t("common.endDate")}
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
                <p className="text-sm font-medium">{t("common.categoriesLabel")}</p>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {ALL_CATEGORIES.map((category) => (
                    <label key={category} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedExportCategories.includes(category)}
                        onChange={() => toggleExportCategory(category)}
                      />
                      {categoryLabelForLocale(category, locale)}
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("common.exportCountSelected", { count: exportableEntries.length })}
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyExport()}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {t("common.copyClipboard")}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadExport}
                  className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  {t("common.downloadFile")}
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
