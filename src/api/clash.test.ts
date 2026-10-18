import { describe, expect, it } from "vitest";

import { normalizeClashBaseUrl } from "./clash";

describe("normalizeClashBaseUrl", () => {
  it("adds a scheme and removes trailing slashes", () => {
    expect(normalizeClashBaseUrl("127.0.0.1:9090")).toBe("http://127.0.0.1:9090");
    expect(normalizeClashBaseUrl("http://127.0.0.1:9090/")).toBe("http://127.0.0.1:9090");
  });

  it("replaces wildcard listeners with loopback addresses", () => {
    expect(normalizeClashBaseUrl("0.0.0.0:9090")).toBe("http://127.0.0.1:9090");
    expect(normalizeClashBaseUrl("[::]:9090")).toBe("http://[::1]:9090");
  });

  it("rejects empty values", () => {
    expect(normalizeClashBaseUrl("   ")).toBeNull();
  });
});
