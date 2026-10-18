import { stripAnsi } from "./ansi";

/**
 * sing-box's observable log formatter emits `tag: message` (or
 * `[id duration] tag: message`). Logger tags can be namespaced, such as
 * `inbound/tun[tun-in]`, so the filter uses the top-level namespace.
 */
export function extractLogType(message: string): string {
  let plain = stripAnsi(message).trim();
  if (plain === "") {
    return "other";
  }

  if (plain.startsWith("[")) {
    const close = plain.indexOf("]");
    if (close !== -1) {
      const prefix = plain.slice(1, close).trim();
      if (/^\d+\s+\S+$/.test(prefix)) {
        plain = plain.slice(close + 1).trim();
      } else if (/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(prefix)) {
        return prefix.toLowerCase();
      }
    }
  }

  const colon = plain.indexOf(":");
  if (colon > 0 && plain[colon + 1] === " ") {
    const tag = plain.slice(0, colon).trim();
    const namespace = tag.split("/")[0]?.split("[")[0]?.trim() ?? "";
    if (/^[a-zA-Z][a-zA-Z0-9_.-]{0,24}$/.test(namespace)) {
      return namespace.toLowerCase();
    }
  }

  const first = plain.split(/\s+/, 1)[0] ?? "";
  if (/^[a-zA-Z][a-zA-Z0-9_.-]{0,24}$/.test(first)) {
    return first.toLowerCase();
  }
  return "other";
}
