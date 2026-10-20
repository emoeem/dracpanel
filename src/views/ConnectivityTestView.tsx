import { useEffect, useMemo, useRef, useState } from "react";

import { ClashApiError, testProxyDelay } from "../api/clash";
import { proxyDisplayType } from "../api/format";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { useI18n } from "../app/i18n";
import { Button, Card, DataLine, Field, Select, Spinner } from "../components/ui";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./ConnectivityTestView.module.css";

const PRESET_TARGETS = [
  { label: "GitHub", url: "https://github.com" },
  { label: "Cloudflare", url: "https://www.cloudflare.com" },
  { label: "YouTube", url: "https://www.youtube.com" },
  { label: "Baidu", url: "https://www.baidu.com" },
] as const;

const ROUNDS = 3;

interface TargetResult {
  min: number;
  avg: number;
  max: number;
  errors: number;
}

interface Candidate {
  value: string;
  label: string;
  tag: string;
}

export function ConnectivityTestView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);
  const outbounds = useStream(api.outbounds);
  const [selected, setSelected] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, TargetResult | string>>({});
  const [error, setError] = useState("");
  // Guard against stale results if the view unmounts mid-test or the user
  // re-runs while a previous run is still resolving — without this the late
  // `setResults` calls would write to a detached component or clobber the
  // newer run.
  const runIdRef = useRef(0);
  useEffect(() => {
    return () => {
      runIdRef.current = -1;
    };
  }, []);

  const candidates = useMemo<Candidate[]>(() => {
    const result: Candidate[] = [];
    const seen = new Set<string>();
    for (const group of groups.data.groups) {
      const tag = group.selected || group.items[0]?.tag || group.tag;
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push({
          value: `group:${group.tag}`,
          label: `${t("Group")}: ${group.tag}`,
          tag,
        });
      }
    }
    for (const outbound of outbounds.data.outbounds) {
      if (!seen.has(outbound.tag)) {
        seen.add(outbound.tag);
        result.push({
          value: `node:${outbound.tag}`,
          label: `${t("Node")}: ${outbound.tag}`,
          tag: outbound.tag,
        });
      }
    }
    return result;
  }, [groups.data.groups, outbounds.data.outbounds, t]);

  useEffect(() => {
    if (selected === "" && candidates.length > 0) {
      setSelected(candidates[0].value);
    }
  }, [candidates, selected]);

  useEffect(() => {
    setResults({});
    setError("");
  }, [selected]);

  const selectedCandidate = candidates.find((candidate) => candidate.value === selected) ?? null;

  const targets = useMemo(() => {
    const list: { label: string; url: string }[] = PRESET_TARGETS.map((target) => ({
      label: target.label,
      url: target.url,
    }));
    const custom = customUrl.trim();
    if (custom !== "") {
      list.push({ label: custom, url: custom });
    }
    return list;
  }, [customUrl]);

  const run = async () => {
    if (selectedCandidate === null || targets.length === 0) {
      return;
    }
    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;
    setRunning(true);
    setError("");
    const next: Record<string, TargetResult | string> = {};
    setResults(next);
    try {
      let fatalError: string | null = null;
      targetLoop: for (const target of targets) {
        const values: number[] = [];
        let errors = 0;
        for (let round = 0; round < ROUNDS; round += 1) {
          try {
            values.push(await testProxyDelay(selectedCandidate.tag, target.url));
          } catch (cause) {
            if (
              cause instanceof ClashApiError &&
              (cause.status === undefined || cause.status === 401 || cause.status === 403)
            ) {
              fatalError = cause.message;
              break targetLoop;
            }
            errors += 1;
            if (values.length === 0 && errors === ROUNDS) {
              next[target.url] = cause instanceof Error ? cause.message : String(cause);
            }
          }
        }
        if (!isCurrent()) {
          return;
        }
        if (values.length > 0) {
          const total = values.reduce((sum, value) => sum + value, 0);
          next[target.url] = {
            min: Math.min(...values),
            avg: Math.round(total / values.length),
            max: Math.max(...values),
            errors,
          };
        }
        setResults({ ...next });
      }
      if (!isCurrent()) {
        return;
      }
      if (fatalError !== null) {
        setResults({});
        setError(fatalError);
      }
    } catch (cause) {
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (isCurrent()) {
        setRunning(false);
      }
    }
  };

  return (
    <div className="page">
      <ToolsPageHeader
        title={t("Connectivity Test")}
        actions={
          <Button
            variant="primary"
            disabled={running || selectedCandidate === null}
            onClick={() => void run()}
          >
            {running ? <Spinner /> : t("Run test")}
          </Button>
        }
      />
      <div className="settings-stack">
        <Card title={t("Target")} icon="network_check">
          <div className={styles.form}>
            <Field label={t("Through")}>
              <Select
                options={candidates.map((candidate) => ({
                  value: candidate.value,
                  label: candidate.label,
                }))}
                value={selected}
                onChange={setSelected}
                placeholder={t("Select a group or node")}
              />
            </Field>
            <Field label={t("Custom URL")}>
              <input
                className="input"
                value={customUrl}
                placeholder="https://example.com"
                onChange={(event) => setCustomUrl(event.target.value)}
              />
            </Field>
          </div>
          {selectedCandidate !== null && (
            <div className={styles.selection}>
              <DataLine label={t("Outbound")} value={selectedCandidate.tag} mono />
              <DataLine
                label={t("Type")}
                value={proxyDisplayType(
                  groups.data.groups.find((group) => group.tag === selectedCandidate.tag)?.type ??
                    outbounds.data.outbounds.find((outbound) => outbound.tag === selectedCandidate.tag)?.type ??
                    "",
                )}
              />
            </div>
          )}
          {error !== "" && <div className={styles.error}>{error}</div>}
        </Card>

        <Card title={t("Results")} icon="speed">
          <div className={styles.results}>
            {targets.map((target) => {
              const result = results[target.url];
              return (
                <div key={target.url} className={styles.result}>
                  <span className={styles.target} title={target.url}>{target.label}</span>
                  {typeof result === "string" ? (
                    <span className={styles.resultError}>{result}</span>
                  ) : result !== undefined ? (
                    <span className={styles.resultValues}>
                      <span>{t("Min")} {result.min}ms</span>
                      <span>{t("Avg")} {result.avg}ms</span>
                      <span>{t("Max")} {result.max}ms</span>
                      {result.errors > 0 && <span className={styles.errors}>{result.errors}×</span>}
                    </span>
                  ) : (
                    <span className={styles.pending}>—</span>
                  )}
                </div>
              );
            })}
          </div>
          {running && (
            <div className={styles.running}>
              <Spinner />
              <span>{t("Testing...")}</span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
