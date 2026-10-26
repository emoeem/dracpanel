import { useEffect, useMemo, useState } from "react";

import { proxyDisplayType, urlTestDelayTone } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useNow } from "../app/context";
import {
  HEALTH_RUN_NOW_EVENT,
  HEALTH_SETTINGS_EVENT,
  loadHealthRun,
  loadHealthSettings,
  saveHealthSettings,
  thresholdsOf,
  type HealthSettings,
} from "../app/healthPreferences";
import { showError } from "../app/errorStore";
import {
  loadAutoTestInterval,
  loadGroupSort,
  loadHideUnavailable,
  saveAutoTestInterval,
  saveGroupSort,
  saveHideUnavailable,
  type AutoTestInterval,
  type GroupSort,
} from "../app/groupPreferences";
import { usePendingValue } from "../app/hooks";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamStates } from "../components/StreamBanner";
import {
  Badge,
  Button,
  Card,
  IconButton,
  MenuItem,
  SearchInput,
  Select,
  Sparkline,
  Spinner,
  Toggle,
  useContextMenu,
} from "../components/ui";
import type { Group, GroupItem } from "../gen/daemon/started_service_pb";
import { healthOf, summarizeHealth, type HealthStatus } from "../lib/healthCheck";
import {
  LATENCY_HISTORY_LIMIT,
  latencyStats,
  type LatencySample,
} from "../lib/latencyHistory";
import { cx } from "../lib/cx";
import styles from "./GroupsView.module.css";

const SORT_OPTIONS: { value: GroupSort; label: MessageKey }[] = [
  { value: "config", label: "Configuration order" },
  { value: "name", label: "Name" },
  { value: "latency", label: "Latency" },
];

const AUTO_TEST_OPTIONS: { value: AutoTestInterval; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
];

function isAvailable(item: GroupItem): boolean {
  if (item.urlTestTime === 0n) {
    return true;
  }
  return item.urlTestDelay > 0;
}

function sortItems(items: GroupItem[], sort: GroupSort): GroupItem[] {
  if (sort === "config") {
    return items;
  }
  const next = [...items];
  if (sort === "name") {
    next.sort((left, right) => left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" }));
    return next;
  }
  next.sort((left, right) => {
    const leftDelay = left.urlTestDelay > 0 ? left.urlTestDelay : Number.POSITIVE_INFINITY;
    const rightDelay = right.urlTestDelay > 0 ? right.urlTestDelay : Number.POSITIVE_INFINITY;
    if (leftDelay !== rightDelay) {
      return leftDelay - rightDelay;
    }
    return left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" });
  });
  return next;
}

export function GroupsView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<GroupSort>(loadGroupSort);
  const [hideUnavailable, setHideUnavailable] = useState(loadHideUnavailable);
  const [autoTest, setAutoTest] = useState<AutoTestInterval>(() =>
    loadAutoTestInterval(api.config.id),
  );
  const [healthSettings, setHealthSettings] = useState<HealthSettings>(loadHealthSettings);
  const now = useNow(30_000);
  const histories = groups.data.latencyHistory;

  useEffect(() => {
    const refresh = () => setHealthSettings(loadHealthSettings());
    window.addEventListener(HEALTH_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(HEALTH_SETTINGS_EVENT, refresh);
  }, []);

  const thresholds = useMemo(() => thresholdsOf(healthSettings), [healthSettings]);

  const statuses = useMemo(() => {
    const result: Record<string, HealthStatus> = {};
    for (const group of groups.data.groups) {
      for (const item of group.items) {
        result[item.tag] = healthOf(histories[item.tag] ?? [], thresholds, now).status;
      }
    }
    return result;
  }, [groups.data.groups, histories, now, thresholds]);

  const healthSummary = useMemo(() => summarizeHealth(Object.values(statuses)), [statuses]);
  const lastRunAt = loadHealthRun(api.config.id).lastRunAt;

  const updateHealth = (patch: Partial<HealthSettings>) => {
    const next = { ...healthSettings, ...patch };
    setHealthSettings(next);
    saveHealthSettings(next);
  };

  const query = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    return groups.data.groups
      .map((group) => {
        const groupMatches = query === "" || group.tag.toLowerCase().includes(query);
        const items = sortItems(
          group.items
            .filter((item) => !hideUnavailable || isAvailable(item))
            .filter(
              (item) =>
                groupMatches ||
                item.tag.toLowerCase().includes(query) ||
                proxyDisplayType(item.type).toLowerCase().includes(query),
            ),
          sort,
        );
        return { group, items, total: group.items.length };
      })
      .filter((entry) => entry.items.length > 0);
  }, [groups.data.groups, hideUnavailable, query, sort]);

  const itemCount = filteredGroups.reduce((total, entry) => total + entry.items.length, 0);

  return (
    <div className="page">
      <PageHeader title={t("Proxies")} />
      <div className={styles.toolbar}>
        <div className={styles.toolbarSearch}>
          <SearchInput value={search} onChange={setSearch} />
        </div>
        <Select
          options={SORT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
          value={sort}
          onChange={(value) => {
            setSort(value);
            saveGroupSort(value);
          }}
        />
        <div className={styles.autoTest}>
          <span>{t("Auto test")}</span>
          <Select
            options={AUTO_TEST_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === "off" ? t("Off") : option.label,
            }))}
            value={autoTest}
            onChange={(value) => {
              setAutoTest(value);
              saveAutoTestInterval(api.config.id, value);
            }}
          />
        </div>
        <Toggle
          label={t("Hide unavailable")}
          value={hideUnavailable}
          onChange={(value) => {
            setHideUnavailable(value);
            saveHideUnavailable(value);
          }}
        />
      </div>
      {groups.data.groups.length > 0 && (
        <Card title={t("Health check")}>
          <div className={styles.healthRow}>
            <Badge tone="good">{t("Healthy {count}", { count: healthSummary.healthy })}</Badge>
            <Badge tone="medium">{t("Slow {count}", { count: healthSummary.degraded })}</Badge>
            <Badge tone="bad">{t("Unavailable {count}", { count: healthSummary.down })}</Badge>
            <Badge>{t("Unknown {count}", { count: healthSummary.unknown })}</Badge>
            <span className={styles.healthMeta}>
              {lastRunAt === 0
                ? t("Not checked yet")
                : t("Last checked {minutes} minutes ago", {
                    minutes: Math.max(1, Math.round((now - lastRunAt) / 60_000)),
                  })}
            </span>
            <Button
              size="small"
              onClick={() => window.dispatchEvent(new Event(HEALTH_RUN_NOW_EVENT))}
            >
              {t("Check now")}
            </Button>
          </div>
          <div className={styles.healthRow}>
            <Toggle
              label={t("Notify on anomalies")}
              value={healthSettings.notify}
              onChange={(value) => updateHealth({ notify: value })}
            />
            <Toggle
              label={t("Auto switch to an available node")}
              value={healthSettings.autoSwitch}
              onChange={(value) => updateHealth({ autoSwitch: value })}
            />
          </div>
          <div className={styles.healthRow}>
            <label className={styles.healthField}>
              {t("Slow threshold")}
              <input
                className="input"
                type="number"
                min={20}
                max={60_000}
                value={healthSettings.degradedMs}
                onChange={(event) => updateHealth({ degradedMs: Number(event.target.value) })}
              />
              ms
            </label>
            <label className={styles.healthField}>
              {t("Unavailable threshold")}
              <input
                className="input"
                type="number"
                min={50}
                max={600_000}
                value={healthSettings.downMs}
                onChange={(event) => updateHealth({ downMs: Number(event.target.value) })}
              />
              ms
            </label>
          </div>
          <div className={styles.healthNote}>
            {t(
              "Checks run only while the tab is visible, using the {interval} interval above; results are stored in this browser.",
              { interval: t("Auto test") },
            )}
          </div>
        </Card>
      )}
      <StreamStates
        snapshot={groups}
        loaded={groups.data.loaded}
        empty={filteredGroups.length === 0}
        emptyIcon="folder"
        emptyMessage={t("Empty groups")}
      />
      {filteredGroups.length > 0 && (
        <div className={styles.summary}>
          {itemCount} {t("Node")}
        </div>
      )}
      {filteredGroups.map(({ group, items, total }) => (
        <GroupCard
          key={group.tag}
          group={group}
          items={items}
          total={total}
          histories={histories}
          statuses={statuses}
        />
      ))}
    </div>
  );
}

function GroupCard(props: {
  group: Group;
  items: GroupItem[];
  total: number;
  histories: Record<string, LatencySample[]>;
  statuses: Record<string, HealthStatus>;
}) {
  const api = useApi();
  const { t } = useI18n();
  const group = props.group;
  const [testing, setTesting] = useState(false);
  const [expanded, setExpandOverride] = usePendingValue(group.isExpand);
  const [selected, setPendingSelection] = usePendingValue(group.selected);

  const toggleExpand = () => {
    const next = !expanded;
    setExpandOverride(next);
    api.setGroupExpand(group.tag, next).catch(() => setExpandOverride(null));
  };

  const runURLTest = () => {
    setTesting(true);
    api
      .urlTest(group.tag)
      .catch(showError)
      .finally(() => setTesting(false));
  };

  const selectItem = (item: GroupItem) => {
    if (!group.selectable || item.tag === selected) {
      return;
    }
    setPendingSelection(item.tag);
    api.selectOutbound(group.tag, item.tag).catch((error: unknown) => {
      setPendingSelection(null);
      showError(error);
    });
  };

  return (
    <div className={cx(styles.groupCard, expanded && styles.expanded)}>
      <Card
        title={
          <>
            {group.tag}
            <span style={{ marginLeft: 8, color: "var(--text-faint)", fontWeight: 500 }}>
              {proxyDisplayType(group.type)}
            </span>
          </>
        }
        actions={
          <>
            <Badge>
              {props.items.length === props.total
                ? props.items.length
                : `${props.items.length}/${props.total}`}
            </Badge>
            {props.statuses[selected] === "down" && (
              <Badge tone="bad">{t("Current node is unavailable")}</Badge>
            )}
            {props.statuses[selected] === "degraded" && (
              <Badge tone="medium">{t("Current node is slow")}</Badge>
            )}
            <IconButton title={t("URL test")} onClick={runURLTest} disabled={testing}>
              {testing ? <Spinner /> : <Icon name="speed" />}
            </IconButton>
            <IconButton
              title={expanded ? t("Collapse") : t("Expand")}
              onClick={toggleExpand}
            >
              <Icon name={expanded ? "expand_less" : "expand_more"} />
            </IconButton>
          </>
        }
      >
        {expanded ? (
          <div className={styles.groupItems}>
            {props.items.map((item) => (
              <GroupItemCard
                key={item.tag}
                item={item}
                selected={item.tag === selected}
                history={props.histories[item.tag] ?? []}
                onSelect={() => selectItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.groupDots}>
            {props.items.map((item) => {
              const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
              return (
                <span
                  key={item.tag}
                  className={cx(styles.groupDot, styles[tone], item.tag === selected && styles.selected)}
                  title={`${item.tag}${item.urlTestDelay > 0 ? ` (${item.urlTestDelay}ms)` : ""}`}
                />
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function GroupItemCard(props: {
  item: GroupItem;
  selected: boolean;
  history: LatencySample[];
  onSelect: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const item = props.item;
  const menu = useContextMenu(
    <MenuItem icon="speed" onSelect={() => api.urlTest(item.tag).catch(showError)}>
      {t("URL test")}
    </MenuItem>,
  );
  const stats = latencyStats(props.history);
  const samples = props.history.map((sample) => sample.delay);

  return (
    <>
      <button
        type="button"
        className={cx(styles.groupItem, props.selected && styles.selected)}
        onClick={props.onSelect}
        {...menu.triggerProps}
      >
        <span className={styles.itemTag} title={item.tag}>{item.tag}</span>
        <span className={styles.itemMeta}>
          <span>{proxyDisplayType(item.type)}</span>
          {item.urlTestDelay > 0 && (
            <span className={cx(styles.delayText, styles[urlTestDelayTone(item.urlTestDelay)])}>
              {item.urlTestDelay}ms
            </span>
          )}
        </span>
        {samples.length > 1 && (
          <span className={styles.itemHistory} title={t("Latency history")}>
            <span className={styles.itemSpark}>
              <Sparkline
                data={samples}
                height={20}
                capacity={LATENCY_HISTORY_LIMIT}
                color="var(--accent)"
              />
            </span>
            {stats !== null && (
              <span className={styles.itemHistoryStats}>
                {t("Min")} {stats.min} · {t("Avg")} {stats.avg} · {t("Max")} {stats.max}
              </span>
            )}
          </span>
        )}
      </button>
      {menu.element}
    </>
  );
}
