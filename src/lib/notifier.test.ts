import { beforeEach, describe, expect, it, vi } from "vitest";

import { TRANSLATIONS } from "../app/translations";
import {
  EMPTY_NOTIFIER,
  NOTIFY_EVENTS,
  isNotifyEnabled,
  loadNotifierConfig,
  normalizeNotifierConfig,
  notify,
  notificationBody,
  saveNotifierConfig,
  sendNotification,
  type NotifyPayload,
} from "./notifier";

const PAYLOAD: NotifyPayload = { event: "error", title: "boom", detail: "detail", at: 1_700_000_000_000 };

function okSender(): (url: string, init: RequestInit) => Promise<Response> {
  return async () => new Response("ok", { status: 200 });
}

function failingSender(): (url: string, init: RequestInit) => Promise<Response> {
  return async () => {
    throw new Error("network down");
  };
}

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }
}

describe("normalizeNotifierConfig", () => {
  it("rejects a non-http url", () => {
    expect(normalizeNotifierConfig({ url: "javascript:alert(1)", events: ["error"] }).url).toBe("");
  });

  it("drops unknown events and duplicates", () => {
    const result = normalizeNotifierConfig({ url: "https://example.com/h", events: ["error", "error", "nope"] });
    expect(result.events).toEqual(["error"]);
  });

  it("falls back to empty for junk", () => {
    expect(normalizeNotifierConfig(null)).toEqual(EMPTY_NOTIFIER);
    expect(normalizeNotifierConfig("x")).toEqual(EMPTY_NOTIFIER);
  });
});

describe("sendNotification", () => {
  it("posts the payload as JSON", async () => {
    const seen: { url: string; body: string; method?: string }[] = [];
    await sendNotification(
      PAYLOAD,
      { url: "https://example.com/hook", events: ["error"] },
      async (url, init) => {
        seen.push({ url, body: String(init.body), method: init.method });
        return new Response("ok", { status: 200 });
      },
    );
    expect(seen[0]?.url).toBe("https://example.com/hook");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toBe(notificationBody(PAYLOAD));
  });

  it("skips events the user did not subscribe to", async () => {
    const result = await sendNotification(PAYLOAD, { url: "https://example.com/hook", events: [] }, okSender());
    expect(result).toBe(false);
  });

  it("reports a rejected status", async () => {
    const result = await sendNotification(
      PAYLOAD,
      { url: "https://example.com/hook", events: ["error"] },
      async () => new Response("nope", { status: 500 }),
    );
    expect(result).toBe(false);
  });

  it("swallows transport failures", async () => {
    const result = await sendNotification(
      PAYLOAD,
      { url: "https://example.com/hook", events: ["error"] },
      failingSender(),
    );
    expect(result).toBe(false);
  });

  it("does nothing without a url", async () => {
    expect(await sendNotification(PAYLOAD, EMPTY_NOTIFIER, okSender())).toBe(false);
  });
});

describe("storage round trip", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("saves and reloads a config", () => {
    saveNotifierConfig({ url: "https://example.com/hook", events: ["error", "service"] });
    expect(loadNotifierConfig()).toEqual({ url: "https://example.com/hook", events: ["error", "service"] });
  });

  it("clears storage when switched off", () => {
    saveNotifierConfig({ url: "https://example.com/hook", events: ["error"] });
    saveNotifierConfig({ url: "https://example.com/hook", events: [] });
    expect(loadNotifierConfig()).toEqual(EMPTY_NOTIFIER);
  });

  it("reads back as empty before anything is saved", () => {
    expect(isNotifyEnabled(loadNotifierConfig(), "error")).toBe(false);
  });

  it("notify does not throw when nothing is configured", () => {
    expect(() => notify("service", "core stopped")).not.toThrow();
  });
});

describe("isNotifyEnabled", () => {
  it("needs both a url and the subscribed event", () => {
    expect(isNotifyEnabled({ url: "https://example.com/hook", events: ["error"] }, "error")).toBe(true);
    expect(isNotifyEnabled({ url: "https://example.com/hook", events: ["error"] }, "health")).toBe(false);
    expect(isNotifyEnabled({ url: "", events: ["error"] }, "error")).toBe(false);
    expect(isNotifyEnabled(EMPTY_NOTIFIER, "error")).toBe(false);
  });
});

describe("normalizeNotifierConfig tolerance", () => {
  it("treats anything unreadable as switched off", () => {
    expect(normalizeNotifierConfig(undefined)).toEqual(EMPTY_NOTIFIER);
    expect(normalizeNotifierConfig(42)).toEqual(EMPTY_NOTIFIER);
    expect(normalizeNotifierConfig([])).toEqual(EMPTY_NOTIFIER);
    expect(normalizeNotifierConfig({})).toEqual(EMPTY_NOTIFIER);
    expect(normalizeNotifierConfig({ url: 42, events: "error" })).toEqual(EMPTY_NOTIFIER);
  });

  it("trims the url and keeps only known, deduplicated events", () => {
    const result = normalizeNotifierConfig({
      url: "  https://example.com/hook  ",
      events: ["health", "health", 7, null],
    });
    expect(result).toEqual({ url: "https://example.com/hook", events: ["health"] });
  });
});

describe("NOTIFY_EVENTS", () => {
  it("only uses i18n keys that are registered in TRANSLATIONS", () => {
    const missing = NOTIFY_EVENTS.flatMap((event) => [event.label, event.hint]).filter(
      (key) => !(key in TRANSLATIONS),
    );
    expect(missing).toEqual([]);
  });

  it("lists every event exactly once", () => {
    expect(NOTIFY_EVENTS.map((event) => event.id).sort()).toEqual(["config", "error", "health", "service"]);
  });
});
