// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, useState } from "react";

import { useVirtualList } from "./useVirtualList";

const VIEWPORT = 240;
const ROW_HEIGHT = 24;

/**
 * jsdom does not lay anything out, so the hook would see every element as
 * zero-sized. These getters give the container a viewport and the rows a height
 * without pulling in a real browser.
 */
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom ships no ResizeObserver.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.dataset?.virtualView === "1" ? VIEWPORT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.dataset?.virtualView === "1" ? Number(this.dataset.total ?? 0) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.dataset?.vkey === undefined ? 0 : ROW_HEIGHT;
    },
  });
});

afterEach(cleanup);

function Harness(props: { count: number }) {
  const [items] = useState(() => Array.from({ length: props.count }, (_, index) => index));
  const list = useVirtualList({
    items,
    getKey: (item: number) => String(item),
    estimate: ROW_HEIGHT,
    overscan: 2,
  });
  return (
    <div data-testid="view" data-virtual-view="1" data-total={list.height} ref={list.containerRef}>
      <div style={{ height: list.height }}>
        {list.rows.map((row) => (
          <div
            key={row.item}
            data-vkey={row.item}
            data-testid={`row-${row.item}`}
            style={{ transform: `translateY(${row.top}px)` }}
          >
            {row.item}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("useVirtualList", () => {
  it("mounts only the rows around the viewport", () => {
    render(<Harness count={1000} />);
    expect(screen.getByTestId("row-0")).toBeTruthy();
    expect(screen.queryByTestId("row-999")).toBeNull();
    // Viewport 240 / row 24 = 10 rows plus overscan on both sides.
    const mounted = document.querySelectorAll("[data-vkey]").length;
    expect(mounted).toBeGreaterThan(8);
    expect(mounted).toBeLessThan(30);
  });

  it("reserves the full height for the scrollbar", () => {
    render(<Harness count={1000} />);
    expect(screen.getByTestId("view").dataset.total).toBe(String(1000 * ROW_HEIGHT));
  });

  it("follows the scroll position", () => {
    render(<Harness count={1000} />);
    const view = screen.getByTestId("view");
    act(() => {
      view.scrollTop = 4800;
      view.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("row-200")).toBeTruthy();
    expect(screen.queryByTestId("row-0")).toBeNull();
  });
});
