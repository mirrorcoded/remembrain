"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type Category =
  | "health"
  | "relationships"
  | "career"
  | "logistics"
  | "emotional"
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

const CATEGORY_BADGE_STYLES: Record<Category, string> = {
  health:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  relationships:
    "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  career:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  logistics:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  emotional:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  other: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

const CATEGORY_ORDER: Category[] = [
  "health",
  "relationships",
  "career",
  "logistics",
  "emotional",
  "other",
];

function sanitizeCategory(value: string): Category {
  const normalizedCategory = value.trim().toLowerCase();
  switch (normalizedCategory) {
    case "health":
    case "relationships":
    case "career":
    case "logistics":
    case "emotional":
    case "other":
      return normalizedCategory;
    default:
      return "other";
  }
}

export default function Home() {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | Category>("all");
  const [isMounted, setIsMounted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechErrorMessage, setSpeechErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [speechRecognitionCtor, setSpeechRecognitionCtor] =
    useState<SpeechRecognitionConstructor | null>(null);
  const isSpeechSupported = speechRecognitionCtor !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef("");
  const finalTranscriptRef = useRef("");

  const availableCategories = useMemo(
    () =>
      CATEGORY_ORDER.filter((category) =>
        entries.some((entry) => entry.category === category),
      ),
    [entries],
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
    const timeoutId = setTimeout(() => {
      void loadEntries();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [loadEntries]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

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
      setText(composeSpeechText(speechBaseTextRef.current, finalTranscriptRef.current));
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stopListening() {
    if (!recognitionRef.current) {
      return;
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

    setIsSaving(true);
    setErrorMessage(null);

    let category: Category = "other";
    try {
      const categorizeResponse = await fetch("/api/categorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: trimmedText }),
      });

      if (categorizeResponse.ok) {
        const result = (await categorizeResponse.json()) as { category?: string };
        category = sanitizeCategory(result.category ?? "other");
      }
    } catch {
      category = "other";
    }

    const { error } = await supabase
      .from("entries")
      .insert({ text: trimmedText, category });

    if (error) {
      setErrorMessage("Could not save entry. Please try again.");
      setIsSaving(false);
      return;
    }

    setText("");
    await loadEntries();
    setIsSaving(false);
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Remembrain</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Capture your thoughts and keep your memories close.
          </p>
        </header>

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
              className="min-h-32 w-full resize-y rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 pr-14 text-base outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
            {isMounted && isSpeechSupported ? (
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                aria-label={isListening ? "Stop voice input" : "Start voice input"}
                className={`absolute bottom-3 right-3 inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-medium transition ${
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
          <button
            type="submit"
            className="mt-3 w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 active:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            disabled={!text.trim() || isSaving}
          >
            {isSaving ? "Categorizing..." : "Save"}
          </button>
        </form>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Saved Entries</h2>
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
                <label htmlFor="entry-search" className="block text-sm font-medium">
                  Search Entries
                </label>
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
                  {availableCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                        activeCategory === category
                          ? CATEGORY_BADGE_STYLES[category]
                          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {category}
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
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatTimestamp(entry.created_at)}
                        </p>
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${CATEGORY_BADGE_STYLES[entry.category]}`}
                        >
                          {entry.category}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                        {entry.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
