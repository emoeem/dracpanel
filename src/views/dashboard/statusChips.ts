/**
 * Chips under the exit IP on the dashboard status card.
 *
 * The panel backend never supplies `ip_type`/`ip_quality` (they are optional
 * contract fields for other backends), so showing "类型未知/质量未知"
 * permanently reads like a fault. Instead: render what the backend really
 * provides, fall back to the GeoIP location (country · city), and state the
 * configuration hint only when no probe source exists at all.
 */

export interface StatusChipInput {
  ip: string | null;
  ipType: string;
  ipQuality: string | null;
  /** "SG · Singapore" from the GeoIP lookup; empty without a hit. */
  geoLocation: string;
  /** False when neither egress_ip nor egress_ip_probe_url is configured. */
  egressConfigured: boolean;
}

export function statusChips(input: StatusChipInput): string[] {
  const ipMissing = input.ip === null || input.ip === "";
  if (ipMissing) {
    return input.egressConfigured
      ? ["待探测"]
      : ["在 panel.json 配置 egress_ip_probe_url"];
  }
  const chips: string[] = [];
  if (input.ipType !== "") {
    chips.push(input.ipType);
  }
  if (input.ipQuality !== null && input.ipQuality !== "") {
    chips.push(`质量 ${input.ipQuality}`);
  }
  // No type/quality data: show where the exit actually is (factual, from GeoIP).
  if (chips.length === 0 && input.geoLocation !== "") {
    chips.push(input.geoLocation);
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
