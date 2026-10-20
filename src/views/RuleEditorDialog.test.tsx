// @vitest-environment jsdom
//
// The rule editor is the one place where a half-filled form silently produces
// a rule that never matches, so it is worth rendering for real: the submit
// guard, the condition rows and the cancel path.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../app/i18n";
import type { RuleDraft } from "../lib/ruleEditor";
import { RuleEditorDialog } from "./RuleEditorDialog";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no modal dialogs; Dialog calls showModal() on mount, and a
  // <dialog> without `open` keeps its children out of the accessibility tree.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
});

const EMPTY: RuleDraft = { action: "route", target: "", invert: false, matchers: [] };

function renderDialog(initial: RuleDraft = EMPTY) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <RuleEditorDialog
        title="Edit rule #1"
        targetLabel="Outbound tag (outbound)"
        targetKey="outbound"
        initial={initial}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </I18nProvider>,
  );
  return { onSubmit, onCancel };
}

describe("RuleEditorDialog", () => {
  it("refuses to submit a route rule without an outbound tag", () => {
    const { onSubmit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("The route action needs an outbound tag")).toBeTruthy();
  });

  it("submits the typed outbound tag", () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("proxy"), { target: { value: "proxy-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ outbound: "proxy-a" });
  });

  it("adds a condition row", () => {
    renderDialog({ ...EMPTY, target: "proxy-a", matchers: [{ key: "domain_suffix", value: "example.com" }] });
    expect(screen.getAllByRole("textbox").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.getAllByRole("textbox").length).toBe(3);
  });

  it("closes without saving when cancelled", () => {
    const { onSubmit, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
