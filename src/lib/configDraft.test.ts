// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  ageParams,
  clearConfigDraft,
  DRAFT_MAX_AGE_MS,
  draftIsMeaningful,
  formatAge,
  normalizeDraft,
  pushUndoEntry,
  readConfigDraft,
  readLastApplied,
  UNDO_LIMIT,
  undoTop,
  writeConfigDraft,
  writeLastApplied,
} from "./configDraft";

const NOW = 1_700_000_000_000;

describe("draft storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round trips a draft", () => {
    writeConfigDraft("new", "old", NOW);
    expect(readConfigDraft(NOW)).toEqual({ text: "new", base: "old", savedAt: NOW });
  });

  it("clears the draft", () => {
    writeConfigDraft("new", "old", NOW);
    clearConfigDraft();
    expect(readConfigDraft(NOW)).toBeNull();
  });

  it("drops stale and malformed drafts", () => {
    expect(normalizeDraft(null, NOW)).toBeNull();
    expect(normalizeDraft({ text: "a" }, NOW)).toBeNull();
    expect(normalizeDraft({ text: "a", base: "b", savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }, NOW)).toBeNull();
    // Clock skew: a draft "from the future" is not trustworthy either.
    expect(normalizeDraft({ text: "a", base: "b", savedAt: NOW + 120_000 }, NOW)).toBeNull();
  });

  it("keeps a draft that is still fresh", () => {
    const savedAt = NOW - 60_000;
    expect(normalizeDraft({ text: "a", base: "b", savedAt }, NOW)?.savedAt).toBe(savedAt);
  });

  it("only offers a restore when the draft differs from the server", () => {
    expect(draftIsMeaningful(null, "same")).toBe(false);
    expect(draftIsMeaningful({ text: "same", base: "same", savedAt: NOW }, "same")).toBe(false);
    expect(draftIsMeaningful({ text: "edited", base: "same", savedAt: NOW }, "same")).toBe(true);
  });
});

describe("last applied snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round trips and survives a cleared draft", () => {
    writeLastApplied("applied", NOW);
    writeConfigDraft("wip", "applied", NOW);
    clearConfigDraft();
    expect(readLastApplied(NOW)).toEqual({ text: "applied", appliedAt: NOW });
  });

  it("rejects unusable payloads", () => {
    expect(readLastApplied(NOW)).toBeNull();
    localStorage.setItem("sing-box-dashboard.panel-config-applied", "{oops");
    expect(readLastApplied(NOW)).toBeNull();
  });
});

describe("undo stack", () => {
  it("pushes, drops duplicates and caps the depth", () => {
    let stack = pushUndoEntry([], "a");
    stack = pushUndoEntry(stack, "a");
    expect(stack).toEqual(["a"]);
    stack = pushUndoEntry(stack, "b");
    expect(stack).toEqual(["a", "b"]);
  });

  it("keeps the newest entries when overflowing", () => {
    let stack: string[] = [];
    for (let index = 0; index < UNDO_LIMIT + 5; index++) {
      stack = pushUndoEntry(stack, `v${index}`);
    }
    expect(stack).toHaveLength(UNDO_LIMIT);
    expect(stack[0]).toBe("v5");
    expect(stack[stack.length - 1]).toBe(`v${UNDO_LIMIT + 4}`);
  });

  it("pops the most recent entry", () => {
    const result = undoTop(["a", "b"]);
    expect(result.text).toBe("b");
    expect(result.stack).toEqual(["a"]);
  });

  it("reports an empty stack", () => {
    expect(undoTop([])).toEqual({ text: null, stack: [] });
  });
});

describe("formatAge", () => {
  it("returns i18n keys with a count placeholder", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(-1000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("{count} minutes ago");
    expect(ageParams(5 * 60_000)).toEqual({ count: 5 });
    expect(formatAge(3 * 3_600_000)).toBe("{count} hours ago");
    expect(ageParams(3 * 3_600_000)).toEqual({ count: 3 });
    expect(formatAge(2 * 86_400_000)).toBe("{count} days ago");
    expect(ageParams(2 * 86_400_000)).toEqual({ count: 2 });
  });
});
