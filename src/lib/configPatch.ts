import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

/**
 * JSONC-preserving edits for the sing-box config.
 *
 * Every editor that writes a config section must build the new text here and
 * send it through applyPanelConfig: the backend writes the caller's text
 * verbatim, so comments and formatting survive. Re-serializing a parsed object
 * (JSON.stringify) drops both.
 */

const FORMAT = {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
};

export type ConfigPath = (string | number)[];

export class ConfigPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigPatchError";
  }
}

function parseErrors(text: string): ParseError[] {
  const errors: ParseError[] = [];
  parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return errors;
}

/** Applies one path/value change and returns the new text. */
export function patchConfigText(text: string, path: ConfigPath, value: unknown): string {
  const errors = parseErrors(text);
  if (errors.length > 0) {
    const first = errors[0];
    throw new ConfigPatchError(`配置文件解析失败（偏移 ${first.offset}）：${String(first.error)}`);
  }
  const edits = modify(text, path, value, FORMAT);
  return applyEdits(text, edits);
}

/** Applies several changes in order; each patch sees the previous result. */
export function patchConfigTextMany(
  text: string,
  patches: readonly { path: ConfigPath; value: unknown }[],
): string {
  return patches.reduce((current, patch) => patchConfigText(current, patch.path, patch.value), text);
}

/** Reads a value without throwing on absent paths. */
export function readConfigValue<T>(text: string, path: ConfigPath, fallback: T): T {
  const errors: ParseError[] = [];
  let value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    return fallback;
  }
  for (const segment of path) {
    if (value === null || typeof value !== "object") {
      return fallback;
    }
    value = (value as Record<string | number, unknown>)[segment];
  }
  return (value as T) ?? fallback;
}
