/**
 * Chips under the exit IP on the dashboard status card.
 *
 * The panel backend never supplies `ip_type`/`ip_quality` (they are optional
 * contract fields for other backends), so showing "类型未知/质量未知"
 * permanently reads like a fault. Instead: render what the backend really
 * provides, fall back to the GeoIP location (country · city), and state the
 * configuration hint only when no probe source exists at all.
 */

import type { MessageKey } from "../../app/translations";
import type { Translate, TranslateParams } from "../../app/i18n";

/**
 * A chip is either backend data (an IP type, a GeoIP city) or a message that
 * has to be translated. Keeping the two apart is what stops a Chinese hint
 * from being baked into the string for every other language.
 */
export type StatusChip =
  | { kind: "text"; text: string }
  | { kind: "message"; key: MessageKey; params?: TranslateParams };

export function chipLabel(chip: StatusChip, t: Translate): string {
  return chip.kind === "text" ? chip.text : t(chip.key, chip.params);
}

export interface StatusChipInput {
  ip: string | null;
  ipType: string;
  ipQuality: string | null;
  /** "SG · Singapore" from the GeoIP lookup; empty without a hit. */
  geoLocation: string;
  /** False when neither egress_ip nor egress_ip_probe_url is configured. */
  egressConfigured: boolean;
}

export function statusChips(input: StatusChipInput): StatusChip[] {
  const ipMissing = input.ip === null || input.ip === "";
  if (ipMissing) {
    return input.egressConfigured
      ? [{ kind: "message", key: "Pending probe" }]
      : [{ kind: "message", key: "Configure an egress probe URL in panel.json" }];
  }
  const chips: StatusChip[] = [];
  if (input.ipType !== "") {
    chips.push({ kind: "text", text: input.ipType });
  }
  if (input.ipQuality !== null && input.ipQuality !== "") {
    chips.push({ kind: "message", key: "Quality {quality}", params: { quality: input.ipQuality } });
  }
  // No type/quality data: show where the exit actually is (factual, from GeoIP).
  if (chips.length === 0 && input.geoLocation !== "") {
    chips.push({ kind: "text", text: input.geoLocation });
  }
  return chips;
}

/** Label/value for the 归属 cell: org if known, else country · city. */
export function attribution(
  organization: string,
  geoLocation: string,
): string {
  if (organization !== "" && organization !== "—") {
    return organization;
  }
  return geoLocation !== "" ? geoLocation : "—";
}
