import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError, reportMessage, resetReportedErrors, setErrorReporter } from "./errorReporting";

afterEach(() => {
  setErrorReporter(null);
  resetReportedErrors();
});

describe("reportError", () => {
  it("forwards to the installed reporter", () => {
    const captureException = vi.fn();
    const captureMessage = vi.fn();
    setErrorReporter({ captureException, captureMessage });

    const error = new Error("boom");
    reportError(error, { where: "ErrorBoundary" });

    expect(captureException).toHaveBeenCalledWith(error, { where: "ErrorBoundary" });
  });

  it("deduplicates identical errors from the same origin", () => {
    const captureException = vi.fn();
    setErrorReporter({ captureException, captureMessage: vi.fn() });

    reportError(new Error("boom"), { where: "a" });
    reportError(new Error("boom"), { where: "a" });

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("keeps errors from different origins separate", () => {
    const captureException = vi.fn();
    setErrorReporter({ captureException, captureMessage: vi.fn() });

    reportError(new Error("boom"), { where: "a" });
    reportError(new Error("boom"), { where: "b" });

    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no reporter is installed", () => {
    expect(() => reportError(new Error("boom"))).not.toThrow();
  });

  it("supports non-Error values", () => {
    const captureException = vi.fn();
    setErrorReporter({ captureException, captureMessage: vi.fn() });

    reportError("plain string");

    expect(captureException).toHaveBeenCalledWith("plain string", undefined);
  });

  it("evicts the oldest fingerprint once the cap is reached", () => {
    const captureException = vi.fn();
    setErrorReporter({ captureException, captureMessage: vi.fn() });

    for (let index = 0; index < 201; index += 1) {
      reportError(new Error(`e${index}`), { where: "loop" });
    }
    reportError(new Error("e0"), { where: "loop" });

    expect(captureException).toHaveBeenCalledTimes(202);
  });
});

describe("reportMessage", () => {
  it("forwards to the installed reporter", () => {
    const captureMessage = vi.fn();
    setErrorReporter({ captureException: vi.fn(), captureMessage });

    reportMessage("hello", { where: "webhook" });

    expect(captureMessage).toHaveBeenCalledWith("hello", { where: "webhook" });
  });
});
