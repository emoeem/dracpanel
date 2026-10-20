// @vitest-environment jsdom
//
// Render tests for the shared UI kit. These cover behaviour that the pure-logic
// tests cannot see: keyboard handling, ARIA wiring and error fallbacks.

import { useState, type ReactNode } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../app/i18n";
import { ErrorBoundary } from "./ErrorBoundary";
import { SkeletonLines } from "./Skeleton";
import { Table, type Column } from "./Table";
import { Tabs, type TabItem } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";

afterEach(() => {
  cleanup();
});

function wrap(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("Tabs", () => {
  const tabs: TabItem<"a" | "b" | "c">[] = [
    { value: "a", label: "第一页" },
    { value: "b", label: "第二页" },
    { value: "c", label: "第三页" },
  ];

  function Harness() {
    const [value, setValue] = useState<"a" | "b" | "c">("a");
    return <Tabs value={value} tabs={tabs} onChange={setValue} idPrefix="test" />;
  }

  it("marks only the active tab as selected", () => {
    wrap(<Harness />);
    expect(screen.getByRole("tab", { name: "第一页" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "第二页" }).getAttribute("aria-selected")).toBe("false");
  });

  it("links each tab to its panel when given an id prefix", () => {
    wrap(<Harness />);
    expect(screen.getByRole("tab", { name: "第一页" }).id).toBe("test-a");
    expect(screen.getByRole("tab", { name: "第一页" }).getAttribute("aria-controls")).toBe("test-panel-a");
  });

  it("keeps a single tab stop using roving tabindex", () => {
    wrap(<Harness />);
    expect(screen.getByRole("tab", { name: "第一页" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "第二页" }).getAttribute("tabindex")).toBe("-1");
  });

  it("moves the selection with the arrow keys", () => {
    wrap(<Harness />);
    const first = screen.getByRole("tab", { name: "第一页" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "第二页" }).getAttribute("aria-selected")).toBe("true");
  });

  it("wraps around with Home and End", () => {
    wrap(<Harness />);
    const first = screen.getByRole("tab", { name: "第一页" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "第三页" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "第三页" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "第一页" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects a tab on click", () => {
    wrap(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "第三页" }));
    expect(screen.getByRole("tab", { name: "第三页" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Table", () => {
  interface Row {
    id: string;
    name: string;
    delay: number;
  }

  const rows: Row[] = [
    { id: "1", name: "slow", delay: 300 },
    { id: "2", name: "fast", delay: 10 },
  ];

  const columns: Column<Row>[] = [
    { key: "name", header: "名称", render: (row) => row.name, sortBy: (row) => row.name },
    { key: "delay", header: "延迟", render: (row) => row.delay, sortBy: (row) => row.delay },
  ];

  it("renders a row per item", () => {
    wrap(<Table columns={columns} rows={rows} rowKey={(row) => row.id} />);
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
    expect(screen.getByText("slow")).toBeTruthy();
  });

  it("shows the empty slot when there is nothing to list", () => {
    wrap(<Table columns={columns} rows={[]} rowKey={(row) => row.id} empty="没有数据" />);
    expect(screen.getByText("没有数据")).toBeTruthy();
  });

  it("sorts on header click and toggles direction", () => {
    wrap(<Table columns={columns} rows={rows} rowKey={(row) => row.id} />);
    const cells = () => screen.getAllByRole("row").slice(1).map((row) => row.textContent);

    fireEvent.click(screen.getByRole("button", { name: /延迟/ }));
    expect(screen.getByRole("columnheader", { name: /延迟/ }).getAttribute("aria-sort")).toBe("ascending");
    expect(cells()).toEqual(["fast10", "slow300"]);

    fireEvent.click(screen.getByRole("button", { name: /延迟/ }));
    expect(screen.getByRole("columnheader", { name: /延迟/ }).getAttribute("aria-sort")).toBe("descending");
    expect(cells()).toEqual(["slow300", "fast10"]);
  });
});

describe("Toast", () => {
  function Harness() {
    const show = useToast();
    return <button onClick={() => show("已保存", "good")}>保存</button>;
  }

  it("announces a toast politely and clears it on click", async () => {
    wrap(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const toast = await screen.findByText("已保存");
    fireEvent.click(toast);
    expect(screen.queryByText("已保存")).toBeNull();
  });
});

describe("ErrorBoundary", () => {
  it("renders the fallback and recovers on retry", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const shouldThrow = { current: true };

    function Boom() {
      if (shouldThrow.current) {
        throw new Error("渲染炸了");
      }
      return <p>恢复</p>;
    }

    wrap(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("渲染炸了");

    shouldThrow.current = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again|重试/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("恢复")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("shows children untouched when nothing throws", () => {
    wrap(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeTruthy();
  });
});

describe("SkeletonLines", () => {
  it("renders the requested number of hidden placeholders", () => {
    const { container } = wrap(<SkeletonLines lines={2} />);
    expect(container.querySelectorAll("span[aria-hidden='true'] > span")).toHaveLength(2);
  });
});
