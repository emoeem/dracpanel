import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import schema from "../../public/sing-box.schema.json";
import { jsonSchemaCompletionSource } from "./jsonSchemaCompletion";

describe("bundled sing-box schema", () => {
  it("completes properties of the log object", () => {
    const doc = '{\n  "log": {\n    \n  }\n}';
    const cursor = doc.indexOf("    \n") + 4;
    const state = EditorState.create({ doc });
    const source = jsonSchemaCompletionSource(
      () => schema as Record<string, unknown>,
    );

    const result = source(new CompletionContext(state, cursor, true));

    expect(result).not.toBeNull();
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("level");
    expect(labels).toContain("timestamp");
  });
});
