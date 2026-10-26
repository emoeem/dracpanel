import { useMemo, useState } from "react";

import { formatBytes, formatDateTime, formatDurationMs } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import {
  buildRequestLedger,
  filterLedgerEntries,
  type RequestLedgerEntry,
  type RequestLedgerFilter,
} from "../lib/requestLedger";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { AdaptiveSegmented, Badge, DataLine, Dialog, EmptyState, SearchInput, Spinner } from "../components/ui";
import styles from "./RequestsView.module.css";

/**
 * Recent-request ledger derived from the live connections stream. The core
 * keeps no historical request log, so this page says so explicitly instead of
 * pretending to show one.
 */
export function RequestsView() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow(1000);
  const connections = useStream(api.connections);
  const [filter, setFilter] = useState<RequestLedgerFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RequestLedgerEntry | null>(null);

  const entries = useMemo(
    () => buildRequestLedger(connections.data.rows.values(), now),
    [connections.data.rows, now],
  );
  const filtered = useMemo(
    () => filterLedgerEntries(entries, filter, search),
    [entries, filter, search],
  );

  if (connections.phase === "error") {
    return (
      <div className="page">
        <PageHeader title={t("Requests")} />
        <EmptyState icon="swap_vert">
          {t("Requests are unavailable while the core is unreachable.")}
        </EmptyState>
      </div>
    );
  }
  if (!connections.data.loaded && connections.phase !== "active") {
    return (
      <div className="page">
        <PageHeader title={t("Requests")} />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={t("Requests")} />
      <div className={styles.requests}>
        <div className={styles.banner}>
          <span className={styles.bannerIcon}>
            <Icon name="info" size={14} />
          </span>
          <span>
            {t(
              "Derived from the live connections stream; the core keeps no historical request log, so entries disappear after a restart.",
            )}
          </span>
        </div>
        <div className={styles.toolbar}>
          <SearchInput value={search} onChange={setSearch} />
          <AdaptiveSegmented
            options={[
              { value: "all", label: t("All") },
              { value: "active", label: t("Active") },
              { value: "closed", label: t("Closed") },
            ]}
            value={filter}
            onChange={(value) => setFilter(value as RequestLedgerFilter)}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="swap_vert">{t("No matching requests")}</EmptyState>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("Time")}</th>
                  <th>{t("Target")}</th>
                  <th>{t("Network")}</th>
                  <th>{t("Rule")}</th>
                  <th>{t("Chain")}</th>
                  <th>{t("Downlink")}</th>
                  <th>{t("Uplink")}</th>
                  <th>{t("Duration")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} onClick={() => setSelected(entry)}>
                    <td className={styles.muted}>{formatDateTime(entry.at, language)}</td>
                    <td className={styles.host} title={entry.host}>
                      {entry.host}
                    </td>
                    <td>{entry.network}</td>
                    <td className={styles.muted} title={entry.rule}>
                      {entry.rule || "—"}
                    </td>
                    <td title={entry.chain}>{entry.chain || "—"}</td>
                    <td className={styles.num}>{formatBytes(entry.downloadTotal)}</td>
                    <td className={styles.num}>{formatBytes(entry.uploadTotal)}</td>
                    <td className={styles.muted}>{formatDurationMs(entry.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selected !== null && (
        <Dialog onClose={() => setSelected(null)}>
          <h3>{selected.host}</h3>
          <DataLine label={t("Time")} value={formatDateTime(selected.at, language)} />
          <DataLine label={t("Network")} value={selected.network} />
          <DataLine label={t("Inbound")} value={selected.inbound || "—"} />
          <DataLine label={t("Rule")} value={selected.rule || "—"} />
          <DataLine label={t("Chain")} value={selected.chain || "—"} />
          <DataLine label={t("Download")} value={formatBytes(selected.downloadTotal)} />
          <DataLine label={t("Upload")} value={formatBytes(selected.uploadTotal)} />
          <DataLine label={t("Duration")} value={formatDurationMs(selected.durationMs)} />
          <DataLine
            label={t("Status")}
            value={
              <Badge tone={selected.closed ? undefined : "good"}>
                {selected.closed ? t("Closed") : t("Active")}
              </Badge>
            }
          />
        </Dialog>
      )}
    </div>
  );
}
