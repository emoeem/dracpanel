import { useCallback, useEffect, useState } from "react";

import { formatBytes, formatDateTime } from "../api/format";
import {
  addSubscription,
  applySubscriptions,
  deleteSubscription,
  getManagedSubscriptions,
  listSubscriptions,
  setSubscriptionSchedule,
  updateAllSubscriptions,
  updateSubscription,
  type PanelManagedSubscriptions,
  type PanelSubscription,
  type PanelSubscriptionUpdate,
} from "../api/panel";
import {
  usePanelCapabilities,
} from "../api/panelCapabilities";
import { afterConfigChange } from "../app/configResync";
import { useApi, useNow } from "../app/context";
import { hasPanelToken } from "../api/panel";
import { useI18n, type Translate } from "../app/i18n";
import { useAsyncGeneration } from "../app/useAsyncGeneration";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { Button, Card, EmptyState, Spinner } from "../components/ui";
import { cx } from "../lib/cx";
import styles from "./ManageView.module.css";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(seconds: number | null | undefined, language: string): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
    return "—";
  }
  return formatDateTime(seconds * 1000, language);
}

function formatInterval(seconds: number, t: Translate): string {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    return t("Every {count} days", { count: seconds / 86400 });
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return t("Every {count} hours", { count: seconds / 3600 });
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return t("Every {count} minutes", { count: seconds / 60 });
  }
  return t("Every {count} seconds", { count: seconds });
}

/**
 * FlClash-style Profiles page: subscription management (import / update /
 * schedule / delete) plus writing the fetched nodes into the live config.
 * Extracted from the former System page subscriptions tab.
 */
export function ProfilesView() {
  const api = useApi();
  const { language, t } = useI18n();
  const capabilities = usePanelCapabilities();
  const managedSupported =
    !capabilities.detected || capabilities.supports("subscriptions.managed");
  const scheduleSupported =
    !capabilities.detected || capabilities.supports("subscriptions.schedule");
  const now = useNow(30_000);
  const [items, setItems] = useState<PanelSubscription[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PanelSubscription | null>(null);
  const [managed, setManaged] = useState<PanelManagedSubscriptions | null>(null);
  const generation = useAsyncGeneration();

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    const round = generation.begin();
    setLoading(true);
    try {
      const [result, managedResult] = await Promise.allSettled([
        listSubscriptions(),
        managedSupported ? getManagedSubscriptions() : Promise.resolve(null),
      ]);
      if (!generation.isCurrent(round)) {
        return;
      }
      if (result.status === "rejected") {
        throw result.reason;
      }
      setItems(result.value.subscriptions ?? []);
      setManaged(
        managedSupported && managedResult.status === "fulfilled"
          ? managedResult.value
          : null,
      );
      setError("");
    } catch (cause) {
      if (!generation.isCurrent(round)) {
        return;
      }
      setError(errorText(cause));
    } finally {
      if (generation.isCurrent(round)) {
        setLoading(false);
      }
    }
  }, [generation, managedSupported]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (url.trim() === "") {
      setError(t("Enter a subscription URL"));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await addSubscription(name.trim(), url.trim());
      if (result.ok) {
        const skipped = result.skipped ?? [];
        setMessage(
          `${result.message ?? ""}${
            skipped.length
              ? t("; unsupported: {items}", { items: skipped.join(", ") })
              : ""
          }`,
        );
        setName("");
        setUrl("");
        await load();
      } else {
        setError(result.message ?? t("Failed to add"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateAll = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await updateAllSubscriptions();
      const results = result.results ?? [];
      const failed = results.filter((item) => !item.ok);
      const skipped = [...new Set(results.flatMap((item) => item.skipped ?? []))];
      const skippedText = skipped.length
        ? t("; unsupported: {items}", { items: skipped.join(", ") })
        : "";
      await load();
      if (!result.ok) {
        setError(result.message ?? t("Failed to update all subscriptions"));
      } else if (failed.length > 0) {
        setMessage(
          `${t("Update complete: {ok} of {total} succeeded", {
            ok: results.length - failed.length,
            total: results.length,
          })}${skippedText}`,
        );
        setError(
          t("{count} subscriptions failed to update: {names} ({reason})", {
            count: failed.length,
            names: failed.map((item) => item.name ?? t("Unnamed")).join(", "),
            reason: failed[0].message ?? t("Unknown error"),
          }),
        );
      } else if (results.length === 0) {
        setMessage(result.message ?? t("No subscriptions need updating"));
      } else {
        setMessage(
          `${t("Update complete: {ok} of {total} succeeded", {
            ok: results.length,
            total: results.length,
          })}${skippedText}`,
        );
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await applySubscriptions();
      await load();
      if (result.ok) {
        setMessage(result.message ?? "");
        await afterConfigChange(api);
      } else {
        setError(result.message ?? t("Failed to write"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  };

  const runItem = async (item: PanelSubscription, action: "update" | "delete") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        action === "update" ? await updateSubscription(item.id) : await deleteSubscription(item.id);
      const skipped =
        action === "update" ? ((result as PanelSubscriptionUpdate).skipped ?? []) : [];
      await load();
      if (result.ok) {
        setMessage(
          `${result.message ?? ""}${
            skipped.length
              ? t("; unsupported: {items}", { items: skipped.join(", ") })
              : ""
          }`,
        );
      } else {
        setError(result.message ?? (action === "update" ? t("Failed to update") : t("Failed to delete")));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const setSchedule = async (item: PanelSubscription, interval: number) => {
    if (!scheduleSupported) {
      setError(t("This panel does not support auto-update settings; available after upgrading to 0.1.0-8."));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await setSubscriptionSchedule(item.id, interval);
      await load();
      if (result.ok) {
        setMessage(result.message ?? t("Auto-update settings saved"));
      } else {
        setError(result.message ?? t("Failed to save auto-update settings"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const managedGroups = [managed?.managed_group, managed?.managed_urltest].filter(
    (value): value is string => Boolean(value),
  );
  const managedCount = managed?.outbound_tags.length ?? 0;
  const applyMessage = managed
    ? t(
        "This writes the subscription nodes, rebuilds the current {count} managed nodes{groups}, then restarts sing-box; failures roll back automatically.",
        {
          count: managedCount,
          groups: managedGroups.length > 0
            ? t(" (groups {names})", { names: managedGroups.join(" / ") })
            : "",
        },
      )
    : t(
        "This writes the subscription nodes into the sing-box configuration and restarts the core; failures roll back automatically.",
      );
  const deleteManagedCount = deleteTarget
    ? (managed?.by_subscription?.[deleteTarget.id]?.length ?? 0)
    : 0;

  return (
    <div className="page">
      <PageHeader title={t("Profiles")} />
      {!hasPanelToken() ? (
        <EmptyState icon="cloud_sync">
          {t("Subscription management requires the sing-box-panel backend; it is unavailable in direct mode.")}
        </EmptyState>
      ) : (
        <>
          <div className={styles.section}>
            {error !== "" && <div className={styles.errorBox}>{error}</div>}
            {message !== "" && <div className={styles.successBox}>{message}</div>}

        <Card title={t("Add subscription")}>
          <div className={styles.formRow}>
            <label className={styles.label}>
              {t("Name")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Optional")}
              />
            </label>
            <label className={cx(styles.label, styles.grow)}>
              {t("URL")}
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/subscription"
                spellCheck={false}
              />
            </label>
            <Button variant="primary" onClick={() => void add()} disabled={busy}>
              {t("Add")}
            </Button>
          </div>
        </Card>

        <div className={styles.toolbar}>
          <span className={styles.muted}>
            {t("{count} subscriptions", { count: items.length })}
            {managedCount > 0 ? t(" · {count} managed nodes", { count: managedCount }) : ""}
            {managedGroups.length > 0
              ? t(" · groups {names}", { names: managedGroups.join(" / ") })
              : ""}
            {managed?.updated
              ? t(" · last written {time}", { time: formatTime(managed.updated, language) })
              : ""}
          </span>
          <div className={styles.actions}>
            <Button onClick={() => void updateAll()} disabled={busy || items.length === 0}>
              {t("Update all")}
            </Button>
            <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={busy || items.length === 0}>
              {t("Write configuration")}
            </Button>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner /> : t("Refresh")}
            </Button>
          </div>
        </div>

        {items.length === 0 && !loading ? (
          <div className={styles.empty}>{t("No subscriptions yet")}</div>
        ) : (
          <div className={styles.rows}>
            {items.map((item) => {
              const userinfo = item.userinfo ?? {};
              const usedBytes = (userinfo.upload ?? 0) + (userinfo.download ?? 0);
              const hasTraffic =
                typeof userinfo.upload === "number" ||
                typeof userinfo.download === "number" ||
                typeof userinfo.total === "number";
              const expire = userinfo.expire;
              const interval = item.update_interval ?? 0;
              const nextUpdate = item.next_update ?? 0;
              const due = nextUpdate > 0 && nextUpdate * 1000 <= now;
              const managedTags = managed?.by_subscription?.[item.id]?.length ?? 0;
              return (
                <div key={item.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <strong>{item.name || t("Unnamed subscription")}</strong>
                    <span className={styles.mono}>{item.url}</span>
                  </div>
                  <div className={styles.rowMeta}>
                    <span>{t("{count} nodes", { count: item.node_count ?? 0 })}</span>
                    {managedTags > 0 ? (
                      <span>{t("{count} managed nodes", { count: managedTags })}</span>
                    ) : null}
                    <span>{t("Updated {time}", { time: formatTime(item.last_update, language) })}</span>
                    {hasTraffic && (
                      <span>
                        {t("Used {size}", { size: formatBytes(usedBytes) })}
                        {typeof userinfo.total === "number" && userinfo.total > 0
                          ? ` / ${formatBytes(userinfo.total)}`
                          : ""}
                        {typeof expire === "number" && expire > 0
                          ? t(" · expires {time}", {
                              time: formatDateTime(expire * 1000, language),
                            })
                          : ""}
                      </span>
                    )}
                    {!hasTraffic && typeof expire === "number" && expire > 0 && (
                      <span>{t("Expires {time}", { time: formatDateTime(expire * 1000, language) })}</span>
                    )}
                    <span>
                      {t("Auto Update")}{" "}
                      {!scheduleSupported ? (
                        <span className={styles.muted}>{t("Requires 0.1.0-8")}</span>
                      ) : (
                        <select
                          value={String(interval)}
                          onChange={(event) => void setSchedule(item, Number(event.target.value))}
                          disabled={busy}
                          aria-label={t("{name} auto-update interval", {
                            name: item.name || item.url,
                          })}
                        >
                          <option value="0">{t("Close")}</option>
                          {interval > 0 && ![21600, 43200, 86400].includes(interval) && (
                            <option value={String(interval)}>{formatInterval(interval, t)}</option>
                          )}
                          <option value="21600">{t("Every 6 hours")}</option>
                          <option value="43200">{t("Every 12 hours")}</option>
                          <option value="86400">{t("Every day")}</option>
                        </select>
                      )}
                    </span>
                    {interval > 0 && (
                      <span>
                        {due
                          ? t("Waiting for auto-update")
                          : t("Next {time}", { time: formatTime(nextUpdate, language) })}
                      </span>
                    )}
                    {item.last_error ? (
                      <span className={styles.errorText}>
                        {t("Failed: {reason}", { reason: item.last_error })}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.actions}>
                    <Button size="small" onClick={() => void runItem(item, "update")} disabled={busy}>
                      {t("Update")}
                    </Button>
                    <Button size="small" variant="danger" onClick={() => setDeleteTarget(item)} disabled={busy}>
                      {t("Delete")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {confirmApply && (
          <ConfirmDialog
            title={t("Write subscription nodes")}
            message={applyMessage}
            confirmLabel={t("Write and restart")}
            busy={busy}
            onConfirm={() => void apply()}
            onClose={() => setConfirmApply(false)}
          />
        )}
        {deleteTarget !== null && (
          <ConfirmDialog
            title={t("Delete subscription")}
            message={t("Delete “{name}”? This does not change the current configuration right now{managed}.", {
              name: deleteTarget.name || deleteTarget.url,
              managed:
                deleteManagedCount > 0
                  ? t("; it currently manages {count} nodes, which the next “Write configuration” removes", {
                      count: deleteManagedCount,
                    })
                  : "",
            })}
            confirmLabel={t("Delete")}
            danger
            busy={busy}
            onConfirm={() => void runItem(deleteTarget, "delete")}
            onClose={() => setDeleteTarget(null)}
          />
        )}
          </div>
        </>
      )}
    </div>
  );
}
