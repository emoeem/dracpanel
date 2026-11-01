import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyPanelConfig,
  getPanelConfig,
  getPolicies,
  hasPanelToken,
  savePolicyOverrides,
  validatePanelConfig,
  type PanelConfig,
  type PanelPolicyGroup,
  type PanelPolicyOverrides,
} from "../../api/panel";
import { useApi } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { useStream } from "../../api/stream";
import type { Group } from "../../gen/daemon/started_service_pb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  FcButton,
  FcCard,
  FcField,
  FcIconButton,
  FcPageToolbar,
  FcSegmented,
  FcSelect,
  FcSheet,
  FcSwitch,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { patchConfigText, readConfigValue } from "../../lib/configPatch";
import { urlTestDelayTone } from "../../api/format";
import { countryCodeOf, flagOfText } from "../../lib/flclash/country";
import { cx } from "../../lib/cx";
import styles from "./Policies.module.css";

type Filter = "all" | "manual" | "auto";

/** Runtime delay info for one group member, from the daemon groups stream. */
interface MemberDelay {
  delay: number;
  /** False when the node has never been latency-tested. */
  tested: boolean;
}

/**
 * One strategy-group card. Browsing filters (region / search / available-only)
 * are view-local state, so they reset when the page reloads and never touch
 * the managed group definition.
 */
function PolicyGroupCard(props: {
  group: PanelPolicyGroup;
  live: Group | undefined;
  coversAllNodes: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { group, live } = props;
  const [region, setRegion] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);

  const delays = useMemo(() => {
    const map = new Map<string, MemberDelay>();
    for (const item of live?.items ?? []) {
      map.set(item.tag, { delay: item.urlTestDelay, tested: item.urlTestTime !== 0n });
    }
    return map;
  }, [live]);

  const current = live?.selected || group.members[0] || "—";
  const currentItem = delays.get(current);
  const usable = live ? live.items.filter((item) => item.urlTestDelay > 0).length : 0;
  const untested = group.members.filter((member) => delays.get(member)?.tested !== true).length;

  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      const code = countryCodeOf(member);
      if (code !== null) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([code, count]) => ({ code, count }));
  }, [group.members]);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return group.members.filter((member) => {
      if (region !== null && countryCodeOf(member) !== region) {
        return false;
      }
      if (availableOnly && (delays.get(member)?.delay ?? 0) <= 0) {
        return false;
      }
      if (query !== "" && !member.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [availableOnly, delays, group.members, region, search]);

  const delay = currentItem?.delay ?? 0;

  return (
    <FcCard className={styles.card}>
      <div className={styles.head}>
        <span className={styles.name}>{group.tag}</span>
        <span className={styles.badge}>{group.type === "urltest" ? "自动选择" : "手动选择"}</span>
        {group.managed && <span className={cx(styles.badge, styles["badge-managed"])}>订阅托管</span>}
        <span className={styles.spacer} />
        <FcIconButton label="编辑" onClick={props.onEdit}>
          <Icon name="edit" size={16} />
        </FcIconButton>
        <FcIconButton label="删除" onClick={props.onDelete}>
          <Icon name="delete" size={16} />
        </FcIconButton>
      </div>
      <div className={styles.summary}>
        当前：{flagOfText(current)} {current}
        {delay > 0 && (
          <>
            {" · "}
            <span className={urlTestDelayTone(delay)}>{delay} ms</span>
          </>
        )}
        {live && ` · ${usable} 个可用`}
        {live && untested > 0 && ` · ${untested} 个未测试`}
        {` · ${group.members.length} 个成员`}
        {props.coversAllNodes && " · 包含所有节点"}
      </div>
      {group.members.length > 0 && (
        <>
          {regions.length >= 2 && (
            <div className={styles["region-row"]}>
              <button
                type="button"
                className={cx(styles["region-chip"], region === null && styles["region-chip-active"])}
                onClick={() => setRegion(null)}
              >
                全部
              </button>
              {regions.map(({ code, count }) => (
                <button
                  key={code}
                  type="button"
                  className={cx(styles["region-chip"], region === code && styles["region-chip-active"])}
                  onClick={() => setRegion(region === code ? null : code)}
                >
                  {code} {count}
                </button>
              ))}
            </div>
          )}
          <div className={styles["card-tools"]}>
            <label className={styles["tool-search"]}>
              <Icon name="search" size={14} />
              <input
                value={search}
                placeholder="筛选节点"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className={styles["tool-toggle"]}>
              <FcSwitch
                checked={availableOnly}
                disabled={live === undefined}
                label="只显示可用节点"
                onChange={setAvailableOnly}
              />
              <span>只显示可用</span>
            </label>
          </div>
        </>
      )}
      <div className={styles.members}>
        {shown.slice(0, 8).map((member) => (
          <span key={member} className={cx(styles.member, member === current && styles["member-current"])}>
            {member}
          </span>
        ))}
        {shown.length > 8 && <span className={styles.member}>+{shown.length - 8}</span>}
        {shown.length === 0 && <span className={styles["members-empty"]}>无匹配成员</span>}
      </div>
    </FcCard>
  );
}

interface ConfigOutbound {
  type?: string;
  tag?: string;
  outbounds?: unknown[];
  url?: string;
  interval?: string;
  tolerance?: number;
  [key: string]: unknown;
}

const GROUP_TYPES = new Set(["selector", "urltest"]);

interface Draft {
  mode: "create" | "edit";
  originalTag?: string;
  tag: string;
  type: "selector" | "urltest";
  members: string[];
  url: string;
  interval: string;
  tolerance: string;
}

function draftOf(group: PanelPolicyGroup): Draft {
  return {
    mode: "edit",
    originalTag: group.tag,
    tag: group.tag,
    type: group.type === "urltest" ? "urltest" : "selector",
    members: [...group.members],
    url: group.url ?? "https://www.gstatic.com/generate_204",
    interval: group.interval ?? "10m",
    tolerance: group.tolerance ? String(group.tolerance) : "",
  };
}

function emptyDraft(): Draft {
  return {
    mode: "create",
    tag: "",
    type: "selector",
    members: [],
    url: "https://www.gstatic.com/generate_204",
    interval: "10m",
    tolerance: "",
  };
}

function draftIssue(draft: Draft, existingTags: string[]): string | null {
  const tag = draft.tag.trim();
  if (tag === "") {
    return "请填写组名";
  }
  const duplicate =
    draft.mode === "create" ? existingTags.includes(tag) : tag !== draft.originalTag && existingTags.includes(tag);
  if (duplicate) {
    return "组名已存在";
  }
  if (draft.members.length === 0) {
    return "至少选择一个成员";
  }
  if (draft.type === "urltest") {
    if (!/^https?:\/\//.test(draft.url.trim())) {
      return "探测 URL 需要以 http(s):// 开头";
    }
    if (!draft.interval.trim()) {
      return "请填写测速间隔（例如 10m）";
    }
  }
  return null;
}

function buildOutbound(draft: Draft, previous?: ConfigOutbound): Record<string, unknown> {
  const base: Record<string, unknown> = previous ? { ...previous } : {};
  base.type = draft.type;
  base.tag = draft.tag.trim();
  base.outbounds = draft.members;
  if (draft.type === "selector") {
    delete base.url;
    delete base.interval;
    delete base.tolerance;
    delete base.default;
  } else {
    base.url = draft.url.trim();
    base.interval = draft.interval.trim();
    const tolerance = Number(draft.tolerance);
    if (Number.isFinite(tolerance) && tolerance > 0) {
      base.tolerance = tolerance;
    } else {
      delete base.tolerance;
    }
  }
  return base;
}

/** 策略：selector/urltest 组的创建、编辑、删除与成员管理。 */
export function PoliciesView() {
  const api = useApi();
  const toast = useToast();
  const runtime = useStream(api.groups);
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [groups, setGroups] = useState<PanelPolicyGroup[]>([]);
  const [overrides, setOverrides] = useState<Record<string, PanelPolicyOverrides>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PanelPolicyGroup | null>(null);
  const [addMember, setAddMember] = useState("");

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      setError("策略编辑需要面板后端");
      return;
    }
    try {
      const [nextConfig, nextPolicies] = await Promise.all([getPanelConfig(), getPolicies()]);
      if (!nextConfig.ok) {
        throw new Error("读取配置失败");
      }
      setConfig(nextConfig);
      setGroups(nextPolicies.groups ?? []);
      setOverrides(nextPolicies.overrides ?? {});
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const outbounds = useMemo<ConfigOutbound[]>(
    () => (config ? readConfigValue<ConfigOutbound[]>(config.text, ["outbounds"], []) : []),
    [config],
  );

  const memberCandidates = useMemo(() => {
    const list: { tag: string; type: string }[] = [];
    for (const item of outbounds) {
      if (!item.tag || !item.type) {
        continue;
      }
      if (item.type === "direct" || item.type === "block") {
        continue;
      }
      list.push({ tag: item.tag, type: item.type });
    }
    return list;
  }, [outbounds]);

  const runtimeGroups = runtime.data.groups;
  const runtimeByTag = useMemo(() => {
    const map = new Map<string, (typeof runtimeGroups)[number]>();
    for (const group of runtimeGroups) {
      map.set(group.tag, group);
    }
    return map;
  }, [runtimeGroups]);

  const filtered = useMemo(() => {
    if (filter === "all") {
      return groups;
    }
    return groups.filter((group) =>
      filter === "manual" ? group.type === "selector" : group.type === "urltest",
    );
  }, [filter, groups]);

  const counts = useMemo(
    () => ({
      all: groups.length,
      manual: groups.filter((group) => group.type === "selector").length,
      auto: groups.filter((group) => group.type === "urltest").length,
    }),
    [groups],
  );

  // Approximates doona's "contains all nodes": the group's members cover every
  // entry visible across all live groups (nodes and nested groups alike).
  const coversAllNodes = useMemo(() => {
    const all = new Set<string>();
    for (const group of runtimeGroups) {
      for (const item of group.items) {
        all.add(item.tag);
      }
    }
    const map = new Map<string, boolean>();
    if (all.size === 0) {
      return map;
    }
    for (const group of groups) {
      map.set(
        group.tag,
        group.members.length >= all.size && group.members.every((member) => all.has(member)),
      );
    }
    return map;
  }, [groups, runtimeGroups]);

  const persist = useCallback(
    async (nextOutbounds: ConfigOutbound[], overrideUpdates: { tag: string; value: PanelPolicyOverrides }[]) => {
      if (!config) {
        throw new Error("配置未就绪");
      }
      const text = patchConfigText(config.text, ["outbounds"], nextOutbounds);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || "配置校验失败，未应用");
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || "写入失败");
      }
      for (const update of overrideUpdates) {
        await savePolicyOverrides(update.tag, update.value);
      }
      await afterConfigChange(api);
      await load();
    },
    [api, config, load],
  );

  const saveDraft = async () => {
    if (!draft) {
      return;
    }
    const issue = draftIssue(draft, groups.map((group) => group.tag));
    if (issue) {
      toast(issue, "danger");
      return;
    }
    setBusy(true);
    try {
      const next = [...outbounds];
      const index =
        draft.mode === "edit"
          ? next.findIndex((item) => item.tag === draft.originalTag)
          : -1;
      const build = buildOutbound(draft, index >= 0 ? next[index] : undefined);
      if (index >= 0) {
        next[index] = build;
      } else {
        next.push(build);
      }

      const updates: { tag: string; value: PanelPolicyOverrides }[] = [];
      const previous = index >= 0 ? groups.find((group) => group.tag === draft.originalTag) : undefined;
      if (previous?.managed) {
        const old = overrides[previous.tag] ?? {};
        const removed = previous.members.filter((member) => !draft.members.includes(member));
        const added = draft.members.filter((member) => !previous.members.includes(member));
        const exclude = [...new Set([...(old.exclude ?? []), ...removed])].filter(
          (tag) => !added.includes(tag),
        );
        updates.push({ tag: draft.tag.trim(), value: { exclude, order: draft.members } });
      }

      await persist(next, updates);
      setDraft(null);
      toast("策略组已保存", "good");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const removeGroup = async (group: PanelPolicyGroup) => {
    setBusy(true);
    try {
      const next = outbounds
        .filter((item) => item.tag !== group.tag)
        .map((item) => {
          if (Array.isArray(item.outbounds) && GROUP_TYPES.has(item.type ?? "")) {
            return { ...item, outbounds: item.outbounds.filter((member) => member !== group.tag) };
          }
          return item;
        });
      await persist(next, []);
      setDeleteTarget(null);
      toast("策略组已删除", "good");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const available = draft
    ? memberCandidates.filter((candidate) => !draft.members.includes(candidate.tag))
    : [];

  return (
    <div className="fc-page">
      <FcPageToolbar
        title="策略"
        subtitle={loading ? "加载中…" : `${counts.all} 个组 · 手动 ${counts.manual} · 自动 ${counts.auto}`}
        actions={
          <FcIconButton label="新建组" onClick={() => setDraft(emptyDraft())}>
            <Icon name="add" size={20} />
          </FcIconButton>
        }
      />
      <div className="fc-page-body">
        <div className={styles.row} style={{ marginBottom: 12 }}>
          <FcSegmented
            ariaLabel="组类型筛选"
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            options={[
              { value: "all", label: `全部 ${counts.all}` },
              { value: "manual", label: `手动选择 ${counts.manual}` },
              { value: "auto", label: `自动选择 ${counts.auto}` },
            ]}
          />
          <span className={styles.note}>sing-box 的组只有单一选择，不支持按 TCP/UDP 分开设置</span>
        </div>

        {error !== "" ? (
          <div className={styles.empty}>{error}</div>
        ) : loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>暂无策略组</div>
        ) : (
          <div className={styles.list}>
            {filtered.map((group) => (
              <PolicyGroupCard
                key={group.tag}
                group={group}
                live={runtimeByTag.get(group.tag)}
                coversAllNodes={coversAllNodes.has(group.tag)}
                onEdit={() => setDraft(draftOf(group))}
                onDelete={() => setDeleteTarget(group)}
              />
            ))}
          </div>
        )}
      </div>

      {draft && (
        <FcSheet
          title={draft.mode === "create" ? "新建策略组" : `编辑 ${draft.originalTag}`}
          subtitle="写入配置并热重载"
          wide
          onClose={() => setDraft(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setDraft(null)}>
                取消
              </FcButton>
              <FcButton disabled={busy} onClick={() => void saveDraft()}>
                {busy ? "保存中…" : "保存"}
              </FcButton>
            </>
          }
        >
          <div className={styles.form}>
            <FcField label="组名">
              <input
                value={draft.tag}
                placeholder="例如 Proxy"
                onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
              />
            </FcField>
            <FcField label="类型" hint={draft.type === "urltest" ? "按探测结果自动选优" : "手动选择当前节点"}>
              <FcSegmented
                ariaLabel="组类型"
                value={draft.type}
                onChange={(value) => setDraft({ ...draft, type: value as Draft["type"] })}
                options={[
                  { value: "selector", label: "手动选择" },
                  { value: "urltest", label: "自动选择" },
                ]}
              />
            </FcField>
            {draft.type === "urltest" && (
              <>
                <FcField label="探测 URL">
                  <input
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </FcField>
                <FcField label="测速间隔" hint="如 10m、5m">
                  <input
                    value={draft.interval}
                    onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
                  />
                </FcField>
                <FcField label="容差（ms）" hint="留空表示默认">
                  <input
                    value={draft.tolerance}
                    inputMode="numeric"
                    onChange={(event) => setDraft({ ...draft, tolerance: event.target.value })}
                  />
                </FcField>
              </>
            )}
            <FcField label={`成员（${draft.members.length}）`}>
              <div className={styles.form}>
                {draft.members.map((member, index) => (
                  <div key={member} className={styles["member-row"]}>
                    <span className={styles["member-name"]}>{member}</span>
                    <FcIconButton
                      label="上移"
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...draft.members];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        setDraft({ ...draft, members: next });
                      }}
                    >
                      <Icon name="unfold_more" size={14} />
                    </FcIconButton>
                    <FcIconButton
                      label="下移"
                      disabled={index === draft.members.length - 1}
                      onClick={() => {
                        const next = [...draft.members];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        setDraft({ ...draft, members: next });
                      }}
                    >
                      <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                        <Icon name="unfold_more" size={14} />
                      </span>
                    </FcIconButton>
                    <FcIconButton
                      label="移除"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          members: draft.members.filter((item) => item !== member),
                        })
                      }
                    >
                      <Icon name="close" size={14} />
                    </FcIconButton>
                  </div>
                ))}
                <div className={styles["add-row"]}>
                  <FcSelect value={addMember} onChange={setAddMember}>
                    <option value="">选择要添加的节点/组…</option>
                    {available.map((candidate) => (
                      <option key={candidate.tag} value={candidate.tag}>
                        {candidate.tag}（{candidate.type}）
                      </option>
                    ))}
                  </FcSelect>
                  <FcButton
                    variant="tonal"
                    disabled={addMember === ""}
                    onClick={() => {
                      setDraft({ ...draft, members: [...draft.members, addMember] });
                      setAddMember("");
                    }}
                  >
                    添加
                  </FcButton>
                </div>
              </div>
            </FcField>
          </div>
        </FcSheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除策略组"
          message={`删除「${deleteTarget.tag}」？引用它的规则会校验失败，需要同步调整。`}
          confirmLabel="删除"
          danger
          busy={busy}
          onConfirm={() => void removeGroup(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
