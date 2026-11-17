/**
 * Talks to the middleman server.
 *
 * Where the server is and its passcode come from two places, in this order:
 *   1. What was typed into the Connection sheet on the phone (saved in storage).
 *   2. EXPO_PUBLIC_SERVER_URL / EXPO_PUBLIC_APP_PASSCODE from the .env file,
 *      baked in when the app is built.
 * With no server URL at all, the app runs in demo mode and makes up a sample
 * summary locally, so every screen can be tried before the server exists.
 */
import { getSettings, type SummaryBody } from "./storage";

export type SummarizeRequest = {
  url: string;
  questions: string[];
};

export type SummarizeResponse = {
  url: string;
  videoId: string;
  title: string;
  questions: string[];
  summary: SummaryBody;
};

export type Connection = {
  serverUrl: string;
  passcode: string;
  source: "phone" | "build" | "none";
};

const ENV_SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL ?? "").trim();
const ENV_PASSCODE = (process.env.EXPO_PUBLIC_APP_PASSCODE ?? "").trim();

/** Long videos are chunked on the server, which can take a couple of minutes. */
const REQUEST_TIMEOUT_MS = 240_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getConnection(): Promise<Connection> {
  const saved = await getSettings();
  if (saved.serverUrl.trim()) {
    return { serverUrl: saved.serverUrl.trim(), passcode: saved.passcode, source: "phone" };
  }
  if (ENV_SERVER_URL) {
    return { serverUrl: ENV_SERVER_URL, passcode: saved.passcode || ENV_PASSCODE, source: "build" };
  }
  return { serverUrl: "", passcode: "", source: "none" };
}

export async function isDemoMode(): Promise<boolean> {
  return (await getConnection()).serverUrl === "";
}

export async function summarize(req: SummarizeRequest, videoId: string): Promise<SummarizeResponse> {
  const conn = await getConnection();
  if (!conn.serverUrl) return demoSummary(req, videoId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(conn.serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-app-passcode": conn.passcode,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError("The server took too long. Long videos can take a few minutes; try again.");
    }
    throw new ApiError("Could not reach the server. Check the address in Connection and your signal.");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON, usually a proxy error page. Fall through to the status message.
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : res.status === 401
          ? "The passcode was not accepted. Check it in Connection."
          : `The server answered with an error (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return normalize(body, req, videoId);
}

/** Never trust the wire: fill gaps so the screens always get the full shape. */
function normalize(body: unknown, req: SummarizeRequest, videoId: string): SummarizeResponse {
  const b = (body ?? {}) as Partial<SummarizeResponse>;
  const s = (b.summary ?? {}) as Partial<SummaryBody>;
  return {
    url: typeof b.url === "string" ? b.url : req.url,
    videoId: typeof b.videoId === "string" ? b.videoId : videoId,
    title: typeof b.title === "string" && b.title ? b.title : "Untitled video",
    questions: Array.isArray(b.questions) ? b.questions.filter((q) => typeof q === "string") : req.questions,
    summary: {
      overview: typeof s.overview === "string" ? s.overview : "",
      keyPoints: Array.isArray(s.keyPoints)
        ? s.keyPoints
            .filter((k) => k && typeof k.text === "string")
            .map((k) => ({ timestamp: Number(k.timestamp) || 0, text: k.text }))
        : [],
      answers: Array.isArray(s.answers)
        ? s.answers
            .filter((a) => a && typeof a.question === "string" && typeof a.answer === "string")
            .map((a) => ({ question: a.question, answer: a.answer }))
        : [],
    },
  };
}

/** YouTube's public oEmbed endpoint gives the real title without any key. */
async function fetchTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" ? data.title : null;
  } catch {
    return null;
  }
}

async function demoSummary(req: SummarizeRequest, videoId: string): Promise<SummarizeResponse> {
  const [title] = await Promise.all([
    fetchTitle(req.url),
    new Promise((resolve) => setTimeout(resolve, 1400)),
  ]);
  return {
    url: req.url,
    videoId,
    title: title ?? "Sample video",
    questions: req.questions,
    summary: {
      overview:
        "Demo mode: no server is set up yet, so this is a sample summary and not what the video says. " +
        "Once the server address is filled in under Connection, this space holds a short overview of the real video.",
      keyPoints: [
        { timestamp: 0, text: "Sample point. Tap a time to open the video right there." },
        { timestamp: 95, text: "Real key points come with the time they happen in the video." },
        { timestamp: 260, text: "Long videos are split into parts on the server and stitched back together." },
        { timestamp: 512, text: "Keep a summary from the Library so it stays at the top." },
      ],
      answers: req.questions.map((question) => ({
        question,
        answer: "Demo mode cannot watch the video. With the server connected, the answer to this question goes here.",
      })),
    },
  };
}
