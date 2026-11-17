/**
 * The one place the app reads and writes data.
 *
 * Every screen goes through this module, so the shape of a saved summary
 * lives here and nowhere else. Everything is kept on the phone in
 * AsyncStorage: one JSON list for the library, one small object for settings.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type KeyPoint = {
  /** Seconds from the start of the video. */
  timestamp: number;
  text: string;
};

export type Answer = {
  question: string;
  answer: string;
};

export type SummaryBody = {
  overview: string;
  keyPoints: KeyPoint[];
  answers: Answer[];
};

export type Summary = {
  id: string;
  url: string;
  videoId: string;
  title: string;
  /** ISO 8601 string. */
  createdAt: string;
  questions: string[];
  summary: SummaryBody;
  notes: string;
  kept: boolean;
  /** True when this entry came from demo mode instead of the real server. */
  demo?: boolean;
};

/** Connection details typed in on the phone. They win over the build-time .env values. */
export type Settings = {
  serverUrl: string;
  passcode: string;
};

const LIBRARY_KEY = "ytsum.library.v1";
const SETTINGS_KEY = "ytsum.settings.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Screens subscribe so a change on one screen shows up on the others. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach((l) => l());
}

function isSummary(value: unknown): value is Summary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.videoId === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.summary === "object" &&
    v.summary !== null
  );
}

async function readAll(): Promise<Summary[]> {
  const raw = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSummary) : [];
  } catch {
    // A corrupt list should not crash the app; start fresh instead.
    return [];
  }
}

async function writeAll(items: Summary[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  emit();
}

/** Newest first, with kept items pinned to the top. */
export async function listSummaries(): Promise<Summary[]> {
  const items = await readAll();
  return items.sort((a, b) => {
    if (a.kept !== b.kept) return a.kept ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function getSummary(id: string): Promise<Summary | null> {
  const items = await readAll();
  return items.find((s) => s.id === id) ?? null;
}

export async function saveSummary(summary: Summary): Promise<void> {
  const items = await readAll();
  const index = items.findIndex((s) => s.id === summary.id);
  if (index >= 0) items[index] = summary;
  else items.push(summary);
  await writeAll(items);
}

export async function updateSummary(
  id: string,
  patch: Partial<Pick<Summary, "notes" | "kept" | "title">>,
): Promise<Summary | null> {
  const items = await readAll();
  const index = items.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const next = { ...items[index], ...patch };
  items[index] = next;
  await writeAll(items);
  return next;
}

export async function deleteSummary(id: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((s) => s.id !== id));
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return { serverUrl: "", passcode: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
      passcode: typeof parsed.passcode === "string" ? parsed.passcode : "",
    };
  } catch {
    return { serverUrl: "", passcode: "" };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  emit();
}
