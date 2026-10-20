import { describe, expect, it } from "vitest";

import { resolveGesture } from "./useDrawerGestures";

const WIDTH = 300;

describe("resolveGesture", () => {
  it("opens when the edge swipe covers enough ground", () => {
    expect(resolveGesture({ open: false, toward: 120, width: WIDTH, elapsedMs: 300 })).toBe(true);
  });

  it("stays closed on a short, slow drag", () => {
    expect(resolveGesture({ open: false, toward: 40, width: WIDTH, elapsedMs: 900 })).toBe(false);
  });

  it("opens on a fast flick even without much distance", () => {
    expect(resolveGesture({ open: false, toward: 30, width: WIDTH, elapsedMs: 40 })).toBe(true);
  });

  it("ignores a drag in the wrong direction", () => {
    expect(resolveGesture({ open: false, toward: -120, width: WIDTH, elapsedMs: 100 })).toBe(false);
  });

  it("closes when an open drawer is pulled back", () => {
    expect(resolveGesture({ open: true, toward: -120, width: WIDTH, elapsedMs: 300 })).toBe(false);
    expect(resolveGesture({ open: true, toward: -30, width: WIDTH, elapsedMs: 40 })).toBe(false);
  });

  it("keeps an open drawer when the pull is small", () => {
    expect(resolveGesture({ open: true, toward: -20, width: WIDTH, elapsedMs: 800 })).toBe(true);
  });

  it("treats pushing further open as still open", () => {
    expect(resolveGesture({ open: true, toward: 60, width: WIDTH, elapsedMs: 500 })).toBe(true);
  });
});
