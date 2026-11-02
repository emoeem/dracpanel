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
import { useI18n, type MessageKey } from "../../app/i18n";
import { useStream } from "../../api/stream";
import type { Group } from "../../gen/daemon/started_service_pb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  FcButton,
  FcCard,
  FcField,
  FcIconButton,
  FcPageToolbar,
  FcSearchField,
  FcSegmented,
  FcSelect,
  FcSheet,
  FcSwitch,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { patchConfigText, readConfigValue } from "../../lib/configPatch";
import { urlTestDelayTone } from "../../api/format";
import { countryCodeInText, flagOfText } from "../../lib/flclash/country";
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
  /** Tags that are themselves groups, so a member can jump to its own card. */
  groupTags: ReadonlySet<string>;
  focused: boolean;
  onFocus: (tag: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
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
      const code = countryCodeInText(member);
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
      if (region !== null && countryCodeInText(member) !== region) {
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
    <div id={`policy-${group.tag}`} className={cx(props.focused && styles.cardFocus)}>
    <FcCard className={styles.card}>
      <div className={styles.head}>
        <span className={styles.name}>{group.tag}</span>
        <span className={styles.badge}>
          {group.type === "urltest" ? t("Auto selection") : t("Manual selection")}
        </span>
        {group.managed && <span className={cx(styles.badge, styles.badgeManaged)}>{t("Managed by subscription")}</span>}
        <span className={styles.spacer} />
        <FcIconButton label={t("Edit")} onClick={props.onEdit}>
          <Icon name="edit" size={16} />
        </FcIconButton>
        <FcIconButton label={t("Delete")} onClick={props.onDelete}>
          <Icon name="delete" size={16} />
        </FcIconButton>
      </div>
      <div className={styles.summary}>
        {t("Current: {name}", { name: `${flagOfText(current)} ${current}` })}
        {delay > 0 && (
          <>
            {" · "}
            <span className={urlTestDelayTone(delay)}>{delay} ms</span>
          </>
        )}
        {live && t(" · {count} available", { count: usable })}
        {live && untested > 0 && t(" · {count} untested", { count: untested })}
        {t(" · {count} members", { count: group.members.length })}
        {props.coversAllNodes && t(" · includes all nodes")}
      </div>
      {group.members.length > 0 && (
        <>
          {regions.length >= 2 && (
            <div className={styles.regionRow}>
              <button
                type="button"
                className={cx(styles.regionChip, region === null && styles.regionChipActive)}
                onClick={() => setRegion(null)}
              >
                {t("All")}
              </button>
              {regions.map(({ code, count }) => (
                <button
                  key={code}
                  type="button"
                  className={cx(styles.regionChip, region === code && styles.regionChipActive)}
                  onClick={() => setRegion(region === code ? null : code)}
                >
                  {code} {count}
                </button>
              ))}
            </div>
          )}
          <div className={styles.cardTools}>
            <FcSearchField
              value={search}
              onChange={setSearch}
              placeholder={t("Filter nodes")}
              compact
              className={styles.toolSearch}
            />
            <label className={styles.toolToggle}>
              <FcSwitch
                checked={availableOnly}
                disabled={live === undefined}
                label={t("Show available nodes only")}
                onChange={setAvailableOnly}
              />
              <span>{t("Available only")}</span>
            </label>
          </div>
        </>
      )}
      <div className={styles.members}>
        {shown.slice(0, 8).map((member) =>
          props.groupTags.has(member) ? (
            <button
              key={member}
              type="button"
              className={cx(styles.member, styles.memberLink, member === current && styles.memberCurrent)}
              title={t("Open {name}", { name: member })}
              onClick={() => props.onFocus(member)}
            >
              {member}
              <Icon name="chevron_right" size={14} />
            </button>
          ) : (
            <span key={member} className={cx(styles.member, member === current && styles.memberCurrent)}>
              {member}
            </span>
          ),
        )}
        {shown.length > 8 && <span className={styles.member}>+{shown.length - 8}</span>}
        {shown.length === 0 && <span className={styles.membersEmpty}>{t("No matching members")}</span>}
      </div>
    </FcCard>
    </div>
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

function draftIssue(draft: Draft, existingTags: string[]): MessageKey | null {
  const tag = draft.tag.trim();
  if (tag === "") {
    return "Enter a group name";
  }
  const duplicate =
    draft.mode === "create" ? existingTags.includes(tag) : tag !== draft.originalTag && existingTags.includes(tag);
  if (duplicate) {
    return "Group name already exists";
  }
  if (draft.members.length === 0) {
    return "Select at least one member";
  }
  if (draft.type === "urltest") {
    if (!/^https?:\/\//.test(draft.url.trim())) {
      return "The probe URL must start with http(s)://";
    }
    if (!draft.interval.trim()) {
      return "Enter a test interval (e.g. 10m)";
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
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const runtime = useStream(api.groups);
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [groups, setGroups] = useState<PanelPolicyGroup[]>([]);
  const [overrides, setOverrides] = useState<Record<string, PanelPolicyOverrides>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [focus, setFocus] = useState<string | null>(() => {
    const query = window.location.hash.split("?")[1] ?? "";
    return new URLSearchParams(query).get("focus");
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PanelPolicyGroup | null>(null);
  const [addMember, setAddMember] = useState("");

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      setError(t("Policy editing requires the panel backend"));
      return;
    }
    try {
      const [nextConfig, nextPolicies] = await Promise.all([getPanelConfig(), getPolicies()]);
      if (!nextConfig.ok) {
        throw new Error(t("Failed to read the configuration"));
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
  }, [t]);

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

  const groupTags = useMemo(() => new Set(groups.map((group) => group.tag)), [groups]);

  useEffect(() => {
    if (focus === null) {
      return;
    }
    const target = document.getElementById(`policy-${focus}`);
    if (target === null) {
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFocus(null), 2600);
    return () => window.clearTimeout(timer);
  }, [focus, filtered]);

  const counts = useMemo(
    () => ({
      all: groups.length,
      manual: groups.filter((group) => group.type === "selector").length,
      auto: groups.filter((group) => group.type === "urltest").length,
    }),
    [groups],
  );

  // doona's "contains all nodes": every proxy node in the config is a member
  // of this group. Computed from the config's outbounds (the authoritative tag
  // list), never from runtime streams that may lag behind.
  const coversAllNodes = useMemo(() => {
    const proxyTags = outbounds
      .filter(
        (item) =>
          typeof item.tag === "string" &&
          item.tag !== "" &&
          item.tag !== "direct" &&
          item.tag !== "block" &&
          !GROUP_TYPES.has(item.type ?? ""),
      )
      .map((item) => item.tag as string);
    const map = new Map<string, boolean>();
    if (proxyTags.length === 0) {
      return map;
    }
    for (const group of groups) {
      map.set(group.tag, proxyTags.every((tag) => group.members.includes(tag)));
    }
    return map;
  }, [groups, outbounds]);

  const persist = useCallback(
    async (nextOutbounds: ConfigOutbound[], overrideUpdates: { tag: string; value: PanelPolicyOverrides }[]) => {
      if (!config) {
        throw new Error(t("Configuration not ready"));
      }
      const text = patchConfigText(config.text, ["outbounds"], nextOutbounds);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || t("Configuration validation failed; not applied"));
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to write"));
      }
      for (const update of overrideUpdates) {
        await savePolicyOverrides(update.tag, update.value);
      }
      await afterConfigChange(api);
      await load();
    },
    [api, config, load, t],
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
      toast(t("Policy group saved"), "good");
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
      toast(t("Policy group deleted"), "good");
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
        title={t("Policies")}
        subtitle={
          loading
            ? t("Loading...")
            : `${t("{count} groups", { count: counts.all })} · ${t("Manual selection")} ${counts.manual} · ${t("Auto selection")} ${counts.auto}`
        }
        actions={
          <FcIconButton label={t("New group")} onClick={() => setDraft(emptyDraft())}>
            <Icon name="add" size={20} />
          </FcIconButton>
        }
      />
      <div className="fc-page-body">
        <div className={styles.filterRow}>
          <FcSegmented
            className={styles.filterTabs}
            ariaLabel={t("Group type filter")}
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            options={[
              { value: "all", label: `${t("All")} ${counts.all}` },
              { value: "manual", label: `${t("Manual selection")} ${counts.manual}` },
              { value: "auto", label: `${t("Auto selection")} ${counts.auto}` },
            ]}
          />
          <span className={styles.note}>
            {t("sing-box groups select a single outbound; TCP/UDP split is not supported")}
          </span>
        </div>

        {error !== "" ? (
          <div className={styles.empty}>{error}</div>
        ) : loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t("No policy groups")}</div>
        ) : (
          <div className={styles.list}>
            {filtered.map((group) => (
              <PolicyGroupCard
                key={group.tag}
                group={group}
                live={runtimeByTag.get(group.tag)}
                coversAllNodes={coversAllNodes.get(group.tag) === true}
                groupTags={groupTags}
                focused={focus === group.tag}
                onFocus={(tag) => {
                  setFilter("all");
                  setFocus(tag);
                }}
                onEdit={() => setDraft(draftOf(group))}
                onDelete={() => setDeleteTarget(group)}
              />
            ))}
          </div>
        )}
      </div>

      {draft && (
        <FcSheet
          title={draft.mode === "create" ? t("New policy group") : t("Edit {name}", { name: draft.originalTag ?? "" })}
          subtitle={t("Writes the configuration and hot-reloads")}
          wide
          onClose={() => setDraft(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setDraft(null)}>
                {t("Cancel")}
              </FcButton>
              <FcButton disabled={busy} onClick={() => void saveDraft()}>
                {busy ? t("Saving...") : t("Save")}
              </FcButton>
            </>
          }
        >
          <div className={styles.form}>
            <FcField label={t("Group name")}>
              <input
                value={draft.tag}
                placeholder={t("e.g. Proxy")}
                onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
              />
            </FcField>
            <FcField
              label={t("Type")}
              hint={draft.type === "urltest" ? t("Picks the best node by probe results") : t("Manually select the current node")}
            >
              <FcSegmented
                ariaLabel={t("Group type")}
                value={draft.type}
                onChange={(value) => setDraft({ ...draft, type: value as Draft["type"] })}
                options={[
                  { value: "selector", label: t("Manual selection") },
                  { value: "urltest", label: t("Auto selection") },
                ]}
              />
            </FcField>
            {draft.type === "urltest" && (
              <>
                <FcField label={t("Probe URL")}>
                  <input
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </FcField>
                <FcField label={t("Test interval")} hint={t("e.g. 10m, 5m")}>
                  <input
                    value={draft.interval}
                    onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
                  />
                </FcField>
                <FcField label={t("Tolerance (ms)")} hint={t("Leave empty for the default")}>
                  <input
                    value={draft.tolerance}
                    inputMode="numeric"
                    onChange={(event) => setDraft({ ...draft, tolerance: event.target.value })}
                  />
                </FcField>
              </>
            )}
            <FcField label={t("Members ({count})", { count: draft.members.length })}>
              <div className={styles.form}>
                {draft.members.map((member, index) => (
                  <div key={member} className={styles.memberRow}>
                    <span className={styles.memberName}>{member}</span>
                    <FcIconButton
                      label={t("Move up")}
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
                      label={t("Move down")}
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
                      label={t("Remove")}
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
                <div className={styles.addRow}>
                  <FcSelect value={addMember} onChange={setAddMember}>
                    <option value="">{t("Select a node/group to add...")}</option>
                    {available.map((candidate) => (
                      <option key={candidate.tag} value={candidate.tag}>
                        {t("{tag} ({type})", { tag: candidate.tag, type: candidate.type })}
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
                    {t("Add")}
                  </FcButton>
                </div>
              </div>
            </FcField>
          </div>
        </FcSheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t("Delete policy group")}
          message={t("Delete “{name}”? Rules referencing it will fail validation and need adjusting.", {
            name: deleteTarget.tag,
          })}
          confirmLabel={t("Delete")}
          danger
          busy={busy}
          onConfirm={() => void removeGroup(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
