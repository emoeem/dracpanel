import { describe, expect, it } from "vitest";

import { filterCommands, moveSelection, scoreCommand } from "./commandPalette";

const ENTRIES = [
  { id: "overview", label: "Overview", group: "Navigate", keywords: "dashboard" },
  { id: "groups", label: "Groups", group: "Navigate" },
  { id: "logs", label: "Logs", group: "Navigate" },
  { id: "clear", label: "Clear Logs", group: "Actions" },
  { id: "rules", label: "Rules", group: "Navigate", keywords: "filter_list route" },
];

describe("scoreCommand", () => {
  it("ranks an exact label match highest", () => {
    expect(scoreCommand(ENTRIES[0], "overview")).toBe("exact");
  });

  it("ranks a prefix above a mid-word match", () => {
    expect(scoreCommand(ENTRIES[1], "gro")).toBe("prefix");
  });

  it("matches a later word", () => {
    expect(scoreCommand(ENTRIES[3], "logs")).toBe("word");
  });

  it("falls back to a substring match", () => {
    expect(scoreCommand(ENTRIES[3], "ear lo")).toBe("substring");
  });

  it("matches on keywords", () => {
    expect(scoreCommand(ENTRIES[0], "dashboard")).toBe("word");
  });

  it("returns none when nothing matches", () => {
    expect(scoreCommand(ENTRIES[0], "zzz")).toBe("none");
  });

  it("treats an empty query as a prefix match", () => {
    expect(scoreCommand(ENTRIES[0], "   ")).toBe("prefix");
  });
});

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands(ENTRIES, "")).toHaveLength(ENTRIES.length);
  });

  it("drops non-matching entries", () => {
    expect(filterCommands(ENTRIES, "zzz")).toEqual([]);
  });

  it("orders the best match first", () => {
    expect(filterCommands(ENTRIES, "logs").map((entry) => entry.id)).toEqual(["logs", "clear"]);
  });

  it("finds an entry by group", () => {
    expect(filterCommands(ENTRIES, "actions").map((entry) => entry.id)).toEqual(["clear"]);
  });

  it("keeps the declaration order within a tier", () => {
    const sameTier = filterCommands(ENTRIES, "nav");
    expect(sameTier.map((entry) => entry.id)).toEqual(["overview", "groups", "logs", "rules"]);
  });

  it("does not mutate the input", () => {
    const input = [...ENTRIES];
    filterCommands(input, "logs");
    expect(input).toEqual(ENTRIES);
  });
});

describe("moveSelection", () => {
  it("clamps at the top", () => {
    expect(moveSelection(0, -1, 5)).toBe(0);
  });

  it("clamps at the bottom", () => {
    expect(moveSelection(4, 1, 5)).toBe(4);
  });

  it("moves within range", () => {
    expect(moveSelection(2, 1, 5)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(moveSelection(3, 1, 0)).toBe(0);
  });
});
