import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { proxyDisplayType } from "../../api/format";
import { useStream } from "../../api/stream";
import { useApi } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useDismiss, usePendingValue } from "../../app/hooks";
import { Icon } from "../../components/Icon";
import { FcCard, FcIconButton } from "../../components/flclash";
import type { Group, GroupItem } from "../../gen/daemon/started_service_pb";
import { runDelayPool } from "../../lib/flclash/delayPool";
import { flagOfText } from "../../lib/flclash/country";
import { loadStoredJson, saveStoredJson } from "../../lib/storage";
import { cx } from "../../lib/cx";
import { ProxyNodeCard } from "./ProxyNodeCard";
import styles from "./ProxiesView.module.css";

export type ProxiesStyle = "tab" | "list";
export type ProxiesSort = "default" | "latency" | "name";
export type ProxiesLayout = "compact" | "standard" | "loose";

interface ProxiesPreferences {
  style: ProxiesStyle;
  sort: ProxiesSort;
  layout: ProxiesLayout;
  hideUnavailable: boolean;
}

const DEFAULTS: ProxiesPreferences = {
  style: "tab",
  sort: "default",
  layout: "standard",
  hideUnavailable: false,
};

const STORAGE_KEY = "proxies-preferences";

function loadPreferences(): ProxiesPreferences {
  const stored = loadStoredJson(STORAGE_KEY) as Partial<ProxiesPreferences> | null;
  if (!stored) {
    return { ...DEFAULTS };
  }
  return {
    style: stored.style === "list" ? "list" : "tab",
    sort: stored.sort === "latency" || stored.sort === "name" ? stored.sort : "default",
    layout: stored.layout === "compact" || stored.layout === "loose" ? stored.layout : "standard",
    hideUnavailable: stored.hideUnavailable === true,
  };
}

function isAvailable(item: GroupItem): boolean {
  if (item.urlTestTime === 0n) {
    return true;
  }
  return item.urlTestDelay > 0;
}

function sortItems(items: GroupItem[], sort: ProxiesSort): GroupItem[] {
  if (sort === "default") {
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

function gridColumns(width: number, layout: ProxiesLayout): number {
  const min = 250;
  let columns = Math.max(Math.ceil((width - 32) / min), 2);
  if (layout === "compact") {
    columns += 1;
  } else if (layout === "loose") {
    columns = Math.max(2, columns - 1);
  }
  return columns;
}

export function ProxiesView() {
  const api = useApi();
  const groups = useStream(api.groups);
  const [preferences, setPreferences] = useState<ProxiesPreferences>(loadPreferences);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [testingGroup, setTestingGroup] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1200);
  useDismiss(menuRef, overflowOpen, () => setOverflowOpen(false));

  const update = (patch: Partial<ProxiesPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      saveStoredJson(STORAGE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => setGridWidth(element.clientWidth || 1200));
    observer.observe(element);
    return () => observer.disconnect();
  }, [preferences.style]);

  const query = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    return groups.data.groups
      .map((group) => {
        const groupMatches = query === "" || group.tag.toLowerCase().includes(query);
        const items = sortItems(
          group.items
            .filter((item) => !preferences.hideUnavailable || isAvailable(item))
            .filter(
              (item) =>
                groupMatches ||
                item.tag.toLowerCase().includes(query) ||
                proxyDisplayType(item.type).toLowerCase().includes(query),
            ),
          preferences.sort,
        );
        return { group, items, total: group.items.length };
      })
      .filter((entry) => entry.items.length > 0);
  }, [groups.data.groups, preferences.hideUnavailable, preferences.sort, query]);

  const activeGroupTag = activeTab ?? filteredGroups[0]?.group.tag ?? null;
  const activeEntry = filteredGroups.find((entry) => entry.group.tag === activeGroupTag) ?? null;

  const testGroup = useCallback(
    async (group: Group, items?: readonly GroupItem[]) => {
      setTestingGroup(group.tag);
      try {
        const targets = items ?? group.items;
        await runDelayPool({
          items: targets,
          run: (item) => api.urlTest(item.tag),
          onBatch: () => {},
          onError: () => {},
        });
      } catch (error) {
        showError(error);
      } finally {
        setTestingGroup(null);
      }
    },
    [api],
  );

  const tabsOverflow = filteredGroups.length > 0;

  return (
    <div className="fc-page">
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>代理</h1>
          <div className={styles.actions}>
            <label className={styles.search}>
              <Icon name="search" size={16} />
              <input
                value={search}
                placeholder="搜索节点"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {activeEntry && (
              <FcIconButton
                label="延迟测试"
                disabled={testingGroup !== null}
                onClick={() => {
                  void testGroup(activeEntry.group, activeEntry.items);
                }}
              >
                {testingGroup === activeEntry.group.tag ? (
                  <span className={styles.spinner} />
                ) : (
                  <Icon name="bolt" size={18} />
                )}
              </FcIconButton>
            )}
            <div className={styles.menuAnchor} ref={menuRef}>
              <FcIconButton
                label="更多选项"
                aria-expanded={overflowOpen}
                onClick={() => setOverflowOpen((value) => !value)}
              >
                <Icon name="more_vert" size={18} />
              </FcIconButton>
              {overflowOpen && (
                <div className={styles.menu} role="menu">
                  <div className={styles.menuGroup}>
                    <div className={styles.menuLabel}>风格</div>
                    {(
                      [
                        { value: "tab", label: "标签页" },
                        { value: "list", label: "列表" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={preferences.style === option.value}
                        className={styles.menuRow}
                        onClick={() => {
                          update({ style: option.value });
                          setOverflowOpen(false);
                        }}
                      >
                        <span className={styles.menuCheck}>
                          {preferences.style === option.value && <Icon name="check" size={14} />}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.menuGroup}>
                    <div className={styles.menuLabel}>排序</div>
                    {(
                      [
                        { value: "default", label: "默认" },
                        { value: "latency", label: "延迟" },
                        { value: "name", label: "名称" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={preferences.sort === option.value}
                        className={styles.menuRow}
                        onClick={() => {
                          update({ sort: option.value });
                          setOverflowOpen(false);
                        }}
                      >
                        <span className={styles.menuCheck}>
                          {preferences.sort === option.value && <Icon name="check" size={14} />}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.menuGroup}>
                    <div className={styles.menuLabel}>布局</div>
                    {(
                      [
                        { value: "compact", label: "紧凑" },
                        { value: "standard", label: "标准" },
                        { value: "loose", label: "宽松" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={preferences.layout === option.value}
                        className={styles.menuRow}
                        onClick={() => {
                          update({ layout: option.value });
                          setOverflowOpen(false);
                        }}
                      >
                        <span className={styles.menuCheck}>
                          {preferences.layout === option.value && <Icon name="check" size={14} />}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.menuDivider} />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={preferences.hideUnavailable}
                    className={styles.menuRow}
                    onClick={() => update({ hideUnavailable: !preferences.hideUnavailable })}
                  >
                    <span className={styles.menuCheck}>
                      {preferences.hideUnavailable && <Icon name="check" size={14} />}
                    </span>
                    隐藏超时代理
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {preferences.style === "tab" && tabsOverflow && (
          <div className={styles.chipStrip}>
            <div className={styles.chips}>
              {filteredGroups.map(({ group }) => (
                <button
                  key={group.tag}
                  type="button"
                  className={cx(styles.chip, group.tag === activeGroupTag && styles.chipActive)}
                  onClick={() => setActiveTab(group.tag)}
                >
                  {group.tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div ref={gridRef} className="fc-page-body">
        {groups.phase === "error" && !groups.data.loaded ? (
          <div className={styles.empty}>策略组不可用，请检查核心连接。</div>
        ) : !groups.data.loaded && groups.phase !== "active" ? (
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={styles.skeletonCard} />
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className={styles.empty}>暂无策略组</div>
        ) : preferences.style === "tab" ? (
          activeEntry && (
            <NodeGrid
              group={activeEntry.group}
              items={activeEntry.items}
              total={activeEntry.total}
              columns={gridColumns(gridWidth, preferences.layout)}
              testingGroup={testingGroup}
              onTestGroup={testGroup}
            />
          )
        ) : (
          <div className={styles.listStack}>
            {filteredGroups.map(({ group, items, total }) => (
              <GroupListCard
                key={group.tag}
                group={group}
                items={items}
                total={total}
                columns={gridColumns(gridWidth, preferences.layout)}
                testing={testingGroup === group.tag}
                onTestGroup={testGroup}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeGrid(props: {
  group: Group;
  items: readonly GroupItem[];
  total: number;
  columns: number;
  testingGroup: string | null;
  onTestGroup: (group: Group, items?: readonly GroupItem[]) => Promise<void>;
}) {
  const api = useApi();
  const group = props.group;
  const [pending, setPending] = usePendingValue(group.selected);
  const [testing, setTesting] = useState<string | null>(null);
  const selected = pending ?? group.selected;
  const computed = group.type.toLowerCase() === "urltest" || group.type.toLowerCase() === "fallback";
  const preferred = computed ? group.items[0]?.tag ?? null : null;

  const select = (tag: string) => {
    if (!group.selectable) {
      return;
    }
    setPending(tag);
    api.selectOutbound(group.tag, tag).catch((error: unknown) => {
      setPending(null);
      showError(error);
    });
  };

  const testNode = (tag: string) => {
    setTesting(tag);
    api
      .urlTest(tag)
      .catch(showError)
      .finally(() => setTesting(null));
  };

  return (
    <div className={styles.groupSection}>
      <div className={styles.groupHeaderRow}>
        <div className={styles.groupHeading}>
          <span className={styles.groupTitle}>{group.tag}</span>
          <span className={styles.groupMeta}>
            {proxyDisplayType(group.type)} · {props.items.length === props.total ? props.items.length : `${props.items.length}/${props.total}`}
          </span>
        </div>
        <FcIconButton
          label={`测试 ${group.tag}`}
          disabled={props.testingGroup === group.tag}
          onClick={() => {
            void props.onTestGroup(group, props.items);
          }}
        >
          {props.testingGroup === group.tag ? (
            <span className={styles.spinner} />
          ) : (
            <Icon name="bolt" size={18} />
          )}
        </FcIconButton>
      </div>
      <div
        className={styles.nodeGrid}
        style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
      >
        {props.items.map((item, index) => (
          <ProxyNodeCard
            key={item.tag}
            item={item}
            index={index}
            selected={item.tag === selected}
            selectable={group.selectable}
            pinned={item.tag === preferred}
            testing={testing === item.tag}
            onSelect={() => select(item.tag)}
            onTest={() => testNode(item.tag)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupListCard(props: {
  group: Group;
  items: readonly GroupItem[];
  total: number;
  columns: number;
  testing: boolean;
  onTestGroup: (group: Group, items?: readonly GroupItem[]) => Promise<void>;
}) {
  const api = useApi();
  const group = props.group;
  const [expanded, setExpanded] = useState(true);
  const [pending, setPending] = usePendingValue(group.selected);
  const [testing, setTesting] = useState<string | null>(null);
  const selected = pending ?? group.selected;
  const selectedItem = group.items.find((item) => item.tag === selected);
  const computed = group.type.toLowerCase() === "urltest" || group.type.toLowerCase() === "fallback";
  const preferred = computed ? group.items[0]?.tag ?? null : null;

  const select = (tag: string) => {
    if (!group.selectable) {
      return;
    }
    setPending(tag);
    api.selectOutbound(group.tag, tag).catch((error: unknown) => {
      setPending(null);
      showError(error);
    });
  };

  const testNode = (tag: string) => {
    setTesting(tag);
    api
      .urlTest(tag)
      .catch(showError)
      .finally(() => setTesting(null));
  };

  return (
    <FcCard className={styles.listCard}>
      <button
        type="button"
        className={styles.listHeader}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={styles.listFlag} aria-hidden="true">
          {flagOfText(group.tag) || <Icon name="layers" size={16} />}
        </span>
        <span className={styles.listHeading}>
          <span className={styles.listTitle}>{group.tag}</span>
          <span className={styles.listMeta}>{selectedItem?.tag ?? group.selected ?? "—"}</span>
        </span>
        <span className={styles.listActions}>
          <FcIconButton
            label={`测试 ${group.tag}`}
            disabled={props.testing}
            onClick={(event) => {
              event.stopPropagation();
              void props.onTestGroup(group, props.items);
            }}
          >
            {props.testing ? <span className={styles.spinner} /> : <Icon name="bolt" size={18} />}
          </FcIconButton>
          <Icon name={expanded ? "expand_less" : "expand_more"} size={20} />
        </span>
      </button>
      {expanded && (
        <div
          className={styles.nodeGrid}
          style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
        >
          {props.items.map((item, index) => (
            <ProxyNodeCard
              key={item.tag}
              item={item}
              index={index}
              selected={item.tag === selected}
              selectable={group.selectable}
              pinned={item.tag === preferred}
              testing={testing === item.tag}
              onSelect={() => select(item.tag)}
              onTest={() => testNode(item.tag)}
            />
          ))}
        </div>
      )}
    </FcCard>
  );
}
