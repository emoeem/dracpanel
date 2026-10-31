export interface ServiceTarget {
  key: string;
  label: string;
  url: string;
}

/** FlClash's service-status list, in the same order as its enum. */
export const SERVICE_TARGETS: readonly ServiceTarget[] = [
  { key: "google", label: "Google", url: "https://www.google.com/generate_204" },
  { key: "github", label: "GitHub", url: "https://github.com" },
  { key: "youtube", label: "YouTube", url: "https://www.youtube.com" },
  { key: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com" },
  { key: "claude", label: "Claude", url: "https://claude.ai" },
  { key: "gemini", label: "Gemini", url: "https://gemini.google.com" },
  { key: "netflix", label: "Netflix", url: "https://www.netflix.com" },
  { key: "disney", label: "Disney+", url: "https://www.disneyplus.com" },
  { key: "prime", label: "Prime Video", url: "https://www.primevideo.com" },
  { key: "spotify", label: "Spotify", url: "https://www.spotify.com" },
  { key: "tiktok", label: "TikTok", url: "https://www.tiktok.com" },
  { key: "discord", label: "Discord", url: "https://discord.com" },
  { key: "bilibili", label: "Bilibili", url: "https://www.bilibili.com" },
];

export type ServiceState =
  | "idle"
  | "testing"
  | "available"
  | "timeout"
  | "unavailable"
  | "error";

export interface ServiceResult {
  key: string;
  state: ServiceState;
  delayMs: number | null;
}

export function classifyServiceResult(delayMs: number | null, error: unknown): ServiceResult {
  if (delayMs !== null && delayMs > 0) {
    return { key: "", state: "available", delayMs };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|deadline/i.test(message)) {
    return { key: "", state: "timeout", delayMs: null };
  }
  if (message !== "") {
    return { key: "", state: "unavailable", delayMs: null };
  }
  return { key: "", state: "unavailable", delayMs: null };
}

export interface ServiceSummary {
  available: number;
  abnormal: number;
  pending: number;
  allAvailable: boolean;
}

export function summarizeServices(results: readonly ServiceResult[]): ServiceSummary {
  let available = 0;
  let abnormal = 0;
  let pending = 0;
  for (const result of results) {
    if (result.state === "available") {
      available += 1;
    } else if (result.state === "idle" || result.state === "testing") {
      pending += 1;
    } else {
      abnormal += 1;
    }
  }
  return {
    available,
    abnormal,
    pending,
    allAvailable: available > 0 && abnormal === 0 && pending === 0,
  };
}

export function serviceTone(state: ServiceState): "good" | "medium" | "bad" | "neutral" {
  switch (state) {
    case "available":
      return "good";
    case "timeout":
      return "medium";
    case "unavailable":
    case "error":
      return "bad";
    default:
      return "neutral";
  }
}

interface GroupLike {
  selected?: string;
  items?: readonly { tag: string }[];
}

/** The outbound FlClash probes services through: the first selected group. */
export function currentProxyTag(groups: readonly GroupLike[]): string | null {
  for (const group of groups) {
    if (group.selected) {
      return group.selected;
    }
  }
  return groups.find((group) => (group.items?.length ?? 0) > 0)?.items?.[0]?.tag ?? null;
}
