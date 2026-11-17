import { Linking } from "react-native";

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pulls the 11-character video id out of the link shapes people actually paste:
 * watch?v=, youtu.be/, shorts/, live/, embed/, and the mobile/music hosts.
 * Returns null when the text is not a YouTube video link.
 */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (ID_PATTERN.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return ID_PATTERN.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && ID_PATTERN.test(v)) return v;
    const [, kind, id] = url.pathname.split("/");
    if (["shorts", "live", "embed", "v"].includes(kind ?? "") && id && ID_PATTERN.test(id)) {
      return id;
    }
  }
  return null;
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function watchUrl(videoId: string, seconds?: number): string {
  const t = seconds && seconds > 0 ? `&t=${Math.floor(seconds)}s` : "";
  return `https://www.youtube.com/watch?v=${videoId}${t}`;
}

/** Opens the YouTube app (or the browser) at the given second. */
export async function openAt(videoId: string, seconds?: number): Promise<void> {
  await Linking.openURL(watchUrl(videoId, seconds));
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
