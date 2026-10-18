import { useState } from "react";

import {
  ClashApiError,
  flushDnsCache,
  flushFakeIpCache,
  queryDns,
  type ClashDnsRecord,
  type ClashDnsResponse,
} from "../api/clash";
import { useI18n } from "../app/i18n";
import { Button, Card, DataLine, Dialog, EmptyState, Field, Select, Spinner } from "../components/ui";
import { loadStoredJson, saveStoredJson } from "../lib/storage";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./DnsToolsView.module.css";

const QUERY_HISTORY_KEY = "dns-query-history";
const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "SOA"] as const;

interface QueryHistoryEntry {
  name: string;
  type: string;
}

const DNS_TYPE_NAMES: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  33: "SRV",
  65: "HTTPS",
  257: "CAA",
};

function loadHistory(): QueryHistoryEntry[] {
  const value = loadStoredJson(QUERY_HISTORY_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is QueryHistoryEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as QueryHistoryEntry).name === "string" &&
      typeof (entry as QueryHistoryEntry).type === "string",
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ClashApiError || error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function recordTypeName(record: ClashDnsRecord): string {
  return record.type !== undefined ? (DNS_TYPE_NAMES[record.type] ?? String(record.type)) : "";
}

export function DnsToolsView() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState("A");
  const [querying, setQuerying] = useState(false);
  const [result, setResult] = useState<ClashDnsResponse | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<QueryHistoryEntry[]>(loadHistory);
  const [cacheBusy, setCacheBusy] = useState<"dns" | "fakeip" | null>(null);
  const [cacheMessage, setCacheMessage] = useState("");
  const [confirmFakeIp, setConfirmFakeIp] = useState(false);

  const remember = (entry: QueryHistoryEntry) => {
    const next = [entry, ...history.filter((item) => item.name !== entry.name || item.type !== entry.type)].slice(0, 8);
    setHistory(next);
    saveStoredJson(QUERY_HISTORY_KEY, next);
  };

  const runQuery = async () => {
    const queryName = name.trim();
    if (queryName === "") {
      return;
    }
    setQuerying(true);
    setError("");
    setResult(null);
    try {
      const response = await queryDns(queryName, type);
      setResult(response);
      remember({ name: queryName, type });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setQuerying(false);
    }
  };

  const flush = async (kind: "dns" | "fakeip") => {
    setCacheBusy(kind);
    setCacheMessage("");
    try {
      if (kind === "dns") {
        await flushDnsCache();
      } else {
        await flushFakeIpCache();
      }
      setCacheMessage(t("Done"));
    } catch (cause) {
      setCacheMessage(errorMessage(cause));
    } finally {
      setCacheBusy(null);
      setConfirmFakeIp(false);
    }
  };

  const sections: { label: string; records: ClashDnsRecord[] }[] = result
    ? [
        { label: t("Answer"), records: result.Answer ?? [] },
        { label: t("Authority"), records: result.Authority ?? [] },
        { label: t("Additional"), records: result.Additional ?? [] },
      ].filter((section) => section.records.length > 0)
    : [];

  return (
    <div className="page">
      <ToolsPageHeader title={t("DNS Tools")} />
      <div className="settings-stack">
        <Card title={t("DNS query")} icon="dns">
          <div className={styles.form}>
            <Field label={t("Name")}>
              <input
                className="input"
                value={name}
                placeholder="example.com"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void runQuery();
                  }
                }}
              />
            </Field>
            <Field label={t("Type")}>
              <Select
                options={DNS_TYPES.map((value) => ({ value, label: value }))}
                value={type}
                onChange={setType}
              />
            </Field>
            <Button
              variant="primary"
              disabled={querying || name.trim() === ""}
              onClick={() => void runQuery()}
            >
              {querying ? <Spinner /> : t("Query")}
            </Button>
          </div>
          {error !== "" && <div className={styles.error}>{error}</div>}
          {querying && (
            <div className={styles.loading}>
              <Spinner />
              <span>{t("Querying...")}</span>
            </div>
          )}
          {result !== null && sections.length === 0 && (
            <EmptyState icon="search">{t("No results")}</EmptyState>
          )}
          {sections.map((section) => (
            <div key={section.label} className={styles.section}>
              <div className={styles.sectionTitle}>{section.label}</div>
              <div className={styles.records}>
                {section.records.map((record, index) => (
                  <div key={`${record.name}-${record.type}-${index}`} className={styles.record}>
                    <span className={styles.recordName}>{record.name ?? "—"}</span>
                    <span className={styles.recordType}>{recordTypeName(record)}</span>
                    <span className={styles.recordTtl}>TTL {record.TTL ?? "—"}</span>
                    <span className={styles.recordData}>{record.data ?? ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {result !== null && (
            <div className={styles.meta}>
              <DataLine label={t("Status")} value={String(result.Status ?? "—")} />
              <DataLine label={t("Server")} value={result.Server ?? "—"} />
            </div>
          )}
        </Card>

        <Card title={t("Query history")} icon="search">
          {history.length === 0 ? (
            <EmptyState icon="search">{t("No history yet")}</EmptyState>
          ) : (
            <div className={styles.history}>
              {history.map((entry) => (
                <Button
                  key={`${entry.name}-${entry.type}`}
                  size="small"
                  onClick={() => {
                    setName(entry.name);
                    setType(entry.type);
                  }}
                >
                  {entry.name} <span className={styles.historyType}>{entry.type}</span>
                </Button>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("Cache")} icon="delete">
          <div className={styles.cacheActions}>
            <Button
              disabled={cacheBusy !== null}
              onClick={() => void flush("dns")}
            >
              {cacheBusy === "dns" ? <Spinner /> : t("Flush DNS cache")}
            </Button>
            <Button
              disabled={cacheBusy !== null}
              onClick={() => setConfirmFakeIp(true)}
            >
              {cacheBusy === "fakeip" ? <Spinner /> : t("Flush FakeIP cache")}
            </Button>
          </div>
          {cacheMessage !== "" && <div className={styles.cacheMessage}>{cacheMessage}</div>}
        </Card>
      </div>
      {confirmFakeIp && (
        <Dialog onClose={() => setConfirmFakeIp(false)}>
          <h3>{t("Flush FakeIP cache")}</h3>
          <p className="dialog-message">{t("Flushing FakeIP mappings may interrupt active connections.")}</p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setConfirmFakeIp(false)}>{t("Cancel")}</Button>
            <Button variant="danger" onClick={() => void flush("fakeip")}>
              {t("Flush FakeIP cache")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
