import { describe, expect, it } from "vitest";

import { safeFallbackUrl } from "./PanelGate";

describe("safeFallbackUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeFallbackUrl("/dash/")).toBe("/dash/");
    expect(safeFallbackUrl("/zashboard/?x=1")).toBe("/zashboard/?x=1");
  });

  it("keeps absolute http(s) URLs", () => {
    expect(safeFallbackUrl("http://127.0.0.1:9090/ui/")).toBe("http://127.0.0.1:9090/ui/");
    expect(safeFallbackUrl("https://example.com/dash")).toBe("https://example.com/dash");
  });

  it("rejects javascript:, data: and protocol-relative URLs", () => {
    expect(safeFallbackUrl("javascript:alert(1)")).toBe("/dash/");
    expect(safeFallbackUrl("data:text/html,<script>")).toBe("/dash/");
    expect(safeFallbackUrl("//evil.example/x")).toBe("/dash/");
  });

  it("falls back when the value is missing or blank", () => {
    expect(safeFallbackUrl(undefined)).toBe("/dash/");
    expect(safeFallbackUrl("   ")).toBe("/dash/");
    expect(safeFallbackUrl("not a url")).toBe("/dash/");
  });
});
