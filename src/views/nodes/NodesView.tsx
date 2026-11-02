import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyPanelConfig,
  getNode,
  getNodes,
  getPanelConfig,
  getPolicies,
  hasPanelToken,
  parseNodeLinks,
  setNodeExcluded,
  updateAllSubscriptions,
  validatePanelConfig,
  type PanelConfig,
  type PanelNode,
  type PanelPolicyGroup,
} from "../../api/panel";
import { navigate, useApi } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { useI18n, type Translate } from "../../app/i18n";
import { useStream } from "../../api/stream";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  FcButton,
  FcCard,
  FcField,
  FcIconButton,
  FcPageToolbar,
  FcRecordTable,
  FcSearchField,
  FcSegmented,
  FcSelect,
  FcSwitch,
  FcSheet,
  FcSparkline,
  type FcColumn,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { patchConfigText, readConfigValue } from "../../lib/configPatch";
import { loadStoredJson, saveStoredJson } from "../../lib/storage";
import { urlTestDelayTone } from "../../api/format";
import { flagOfText } from "../../lib/flclash/country";
import { runDelayPool } from "../../lib/flclash/delayPool";
import styles from "../ops/ops.module.css";

type Tab = "list" | "latency";

const GROUP_ORIGIN_KEY = "nodes-group-origin";

interface OutboundRecord {
  type?: string;
  tag?: string;
  outbounds?: unknown[];
  [key: string]: unknown;
}

interface NodeRow extends PanelNode {
  delay: number;
  groups: string[];
}

function nodeDelay(delay: number, timeout: boolean, t: Translate) {
  if (delay > 0) {
    return <span className={urlTestDelayTone(delay)}>{delay} ms</span>;
  }
  return timeout ? t("Timeout") : "—";
}

/** 节点：列表/延迟双视图、粘贴导入、编辑与删除。 */
export function NodesView() {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const runtime = useStream(api.groups);
  const [nodes, setNodes] = useState<PanelNode[]>([]);
  const [policies, setPolicies] = useState<PanelPolicyGroup[]>([]);
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("");
  const [groupByOrigin, setGroupByOrigin] = useState(() => loadStoredJson(GROUP_ORIGIN_KEY) === true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [editTag, setEditTag] = useState<string | null>(null);
  const [editJson, setEditJson] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PanelNode | null>(null);

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      setError(t("Node management requires the panel backend"));
      return;
    }
    try {
      const [nextConfig, nextNodes, nextPolicies] = await Promise.all([
        getPanelConfig(),
        getNodes(),
        getPolicies(),
      ]);
      if (!nextConfig.ok) {
        throw new Error(t("Failed to read the configuration"));
      }
      setConfig(nextConfig);
      setNodes(nextNodes.nodes ?? []);
      setPolicies(nextPolicies.groups ?? []);
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

  const outbounds = useMemo<OutboundRecord[]>(
    () => (config ? readConfigValue<OutboundRecord[]>(config.text, ["outbounds"], []) : []),
    [config],
  );

  const membership = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of policies) {
      for (const member of group.members) {
        const list = map.get(member) ?? [];
        list.push(group.tag);
        map.set(member, list);
      }
    }
    return map;
  }, [policies]);

  const runtimeByTag = useMemo(() => {
    const map = new Map<string, { delay: number; timeout: boolean }>();
    for (const group of runtime.data.groups) {
      for (const item of group.items) {
        const existing = map.get(item.tag);
        const timeout = item.urlTestTime > 0n && item.urlTestDelay <= 0;
        if (!existing || (item.urlTestDelay > 0 && existing.delay <= 0)) {
          map.set(item.tag, { delay: item.urlTestDelay, timeout });
        }
      }
    }
    return map;
  }, [runtime.data.groups]);

  const rows = useMemo<NodeRow[]>(
    () =>
      nodes.map((node) => {
        const live = runtimeByTag.get(node.tag);
        return {
          ...node,
          delay: live?.delay ?? 0,
          groups: membership.get(node.tag) ?? [],
        };
      }),
    [membership, nodes, runtimeByTag],
  );

  const groupOptions = useMemo(
    () => [...new Set(policies.map((group) => group.tag))].sort(),
    [policies],
  );
  const protocolOptions = useMemo(
    () => [...new Set(nodes.map((node) => node.type))].sort(),
    [nodes],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query !== "" && !row.tag.toLowerCase().includes(query) && !row.server.toLowerCase().includes(query)) {
        return false;
      }
      if (groupFilter !== "" && !row.groups.includes(groupFilter)) {
        return false;
      }
      if (protocolFilter !== "" && row.type !== protocolFilter) {
        return false;
      }
      return true;
    });
  }, [groupFilter, protocolFilter, rows, search]);

  // Subscription nodes and hand-written nodes are edited through different
  // flows, so the list can be split by origin instead of shown as one long run.
  const originGroups = useMemo(() => {
    const order = ["managed", "manual"];
    const buckets = new Map<string, NodeRow[]>();
    for (const row of filtered) {
      const key = row.origin === "" ? "other" : row.origin;
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [row]);
      } else {
        bucket.push(row);
      }
    }
    const rank = (key: string) => {
      const index = order.indexOf(key);
      return index === -1 ? order.length : index;
    };
    return [...buckets.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([origin, items]) => ({ origin, items }));
  }, [filtered]);

  const writeOutbounds = useCallback(
    async (next: OutboundRecord[]) => {
      if (!config) {
        throw new Error(t("Configuration not ready"));
      }
      const text = patchConfigText(config.text, ["outbounds"], next);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || t("Configuration validation failed; not applied"));
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to write"));
      }
      await afterConfigChange(api);
      await load();
    },
    [api, config, load, t],
  );

  const testAll = async () => {
    if (testing || filtered.length === 0) {
      return;
    }
    setTesting(true);
    try {
      await runDelayPool({
        items: filtered,
        run: (row) => api.urlTest(row.tag),
        onBatch: () => undefined,
        onError: () => undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  const syncSubscriptions = async () => {
    setBusy(true);
    try {
      const result = await updateAllSubscriptions();
      if (!result.ok) {
        throw new Error(result.message || t("Subscription update failed"));
      }
      toast(t("Subscriptions updated"), "good");
      await load();
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const submitPaste = async () => {
    if (pasteText.trim() === "") {
      return;
    }
    setBusy(true);
    try {
      const parsed = await parseNodeLinks(pasteText);
      const parsedNodes = (parsed.nodes ?? []) as OutboundRecord[];
      if (parsedNodes.length === 0) {
        throw new Error(parsed.message || t("No nodes were parsed"));
      }
      const existing = new Set(outbounds.map((item) => item.tag));
      const next = [...outbounds];
      let added = 0;
      for (const node of parsedNodes) {
        const tag = String(node.tag ?? "");
        if (tag === "" || existing.has(tag)) {
          continue;
        }
        existing.add(tag);
        next.push(node);
        added += 1;
      }
      if (added === 0) {
        throw new Error(t("All parsed node names already exist"));
      }
      await writeOutbounds(next);
      toast(t("Added {count} nodes", { count: added }), "good");
      setPasteOpen(false);
      setPasteText("");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const openEditor = async (tag: string) => {
    setBusy(true);
    try {
      const result = await getNode(tag, true);
      if (!result.ok || !result.node) {
        throw new Error(t("Failed to read the node"));
      }
      setEditJson(JSON.stringify(result.node, null, 2));
      setEditTag(tag);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = async () => {
    if (editTag === null) {
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(editJson) as OutboundRecord;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("A node must be a JSON object"));
      }
      if (String(parsed.tag ?? "") !== editTag) {
        throw new Error(t("Renaming a node breaks rule references; delete it and create a new one instead"));
      }
      const next = outbounds.map((item) => (item.tag === editTag ? parsed : item));
      await writeOutbounds(next);
      setEditTag(null);
      toast(t("Node saved"), "good");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const removeNode = async (node: PanelNode) => {
    setBusy(true);
    try {
      const next = outbounds
        .filter((item) => item.tag !== node.tag)
        .map((item) => {
          if (Array.isArray(item.outbounds)) {
            return { ...item, outbounds: item.outbounds.filter((member) => member !== node.tag) };
          }
          return item;
        });
      await writeOutbounds(next);
      if (node.origin === "managed") {
        await setNodeExcluded(node.tag, true);
      }
      setDeleteTarget(null);
      toast(t("Node deleted"), "good");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const columns: FcColumn<NodeRow>[] = [
    { key: "tag", label: t("Node"), flex: 2, render: (row) => `${flagOfText(row.tag)} ${row.tag}` },
    { key: "type", label: t("Type"), flex: 1, render: (row) => row.type },
    { key: "server", label: t("Server"), flex: 2, hideBelow: 900, render: (row) => row.server || "—" },
    {
      key: "groups",
      label: t("Member groups"),
      flex: 1,
      hideBelow: 760,
      render: (row) => (row.groups.length > 0 ? row.groups.slice(0, 2).join(" / ") : "—"),
    },
    {
      key: "delay",
      label: t("Latency"),
      width: 90,
      align: "end",
      render: (row) => nodeDelay(row.delay, false, t),
    },
    {
      key: "actions",
      label: "",
      width: 84,
      align: "end",
      render: (row) => (
        <>
          <FcIconButton label={t("Edit")} onClick={() => void openEditor(row.tag)}>
            <Icon name="edit" size={16} />
          </FcIconButton>
          <FcIconButton label={t("Delete")} onClick={() => setDeleteTarget(row)}>
            <Icon name="delete" size={16} />
          </FcIconButton>
        </>
      ),
    },
  ];

  return (
    <div className="fc-page">
      <FcPageToolbar
        title={t("Node")}
        subtitle={
          loading ? t("Loading...") : t("{count} / {total} nodes", { count: filtered.length, total: nodes.length })
        }
        actions={
          <>
            <FcIconButton label={t("Update Subscription")} disabled={busy} onClick={() => void syncSubscriptions()}>
              <Icon name="sync" size={18} />
            </FcIconButton>
            <FcIconButton label={t("Add subscription")} onClick={() => navigate("profiles")}>
              <Icon name="add" size={18} />
            </FcIconButton>
            <FcIconButton label={t("Paste node links")} onClick={() => setPasteOpen(true)}>
              <Icon name="link" size={18} />
            </FcIconButton>
            <FcIconButton label={t("URLTest All")} disabled={testing} onClick={() => void testAll()}>
              <Icon name="speed" size={18} />
            </FcIconButton>
          </>
        }
      />
      <div className="fc-page-body">
        <div className={styles.filters}>
          <FcSegmented
            ariaLabel={t("Node view")}
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: "list", label: t("List") },
              { value: "latency", label: t("Latency") },
            ]}
          />
          <FcSearchField
            value={search}
            onChange={setSearch}
            placeholder={t("Search nodes")}
            className={styles.filterSearch}
          />
          <FcSelect value={groupFilter} onChange={setGroupFilter}>
            <option value="">{t("All groups")}</option>
            {groupOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </FcSelect>
          <label className={styles.switchField}>
            <FcSwitch
              checked={groupByOrigin}
              label={t("Group by source")}
              onChange={(value) => {
                setGroupByOrigin(value);
                saveStoredJson(GROUP_ORIGIN_KEY, value);
              }}
            />
            <span>{t("Group by source")}</span>
          </label>
          <FcSelect value={protocolFilter} onChange={setProtocolFilter}>
            <option value="">{t("All protocols")}</option>
            {protocolOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </FcSelect>
        </div>

        {error !== "" ? (
          <div className={styles.empty}>{error}</div>
        ) : loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
        ) : tab === "list" ? (
          groupByOrigin ? (
            <>
              {originGroups.length === 0 && (
                <FcCard>
                  <div className={styles.empty}>{t("No nodes")}</div>
                </FcCard>
              )}
              {originGroups.map((group) => (
                <FcCard key={group.origin}>
                  <div className={styles.groupHeading}>
                    <span>
                      {group.origin === "managed"
                        ? t("Subscribed nodes")
                        : group.origin === "manual"
                          ? t("Manual nodes")
                          : t("Other")}
                    </span>
                    <span className={styles.groupCount}>{group.items.length}</span>
                  </div>
                  <FcRecordTable
                    columns={columns}
                    rows={group.items}
                    getKey={(row) => row.tag}
                    emptyLabel={t("No nodes")}
                    maxRows={400}
                  />
                </FcCard>
              ))}
            </>
          ) : (
            <FcCard>
              <FcRecordTable
                columns={columns}
                rows={filtered}
                getKey={(row) => row.tag}
                emptyLabel={t("No nodes")}
                maxRows={400}
              />
            </FcCard>
          )
        ) : (
          <FcCard>
            <div className={styles.list}>
              {filtered.length === 0 && <div className={styles.empty}>{t("No nodes")}</div>}
              {filtered.map((row) => {
                const history = (runtime.data.latencyHistory[row.tag] ?? []).map((sample) => sample.delay);
                return (
                  <div key={row.tag} className={styles.event}>
                    <span className={styles.body}>
                      <span className={styles.title}>
                        {flagOfText(row.tag)} {row.tag}
                      </span>
                      <span className={styles.detail}>{row.type}</span>
                    </span>
                    <span style={{ width: 140 }}>
                      <FcSparkline data={history.length > 0 ? history : [0, 0]} height={36} />
                    </span>
                    <span className={styles.flowValue}>{nodeDelay(row.delay, false, t)}</span>
                  </div>
                );
              })}
            </div>
          </FcCard>
        )}
      </div>

      {pasteOpen && (
        <FcSheet
          title={t("Paste node links")}
          subtitle={t("Supports ss / vmess / vless / trojan / hysteria2 / tuic, one per line")}
          wide
          onClose={() => setPasteOpen(false)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setPasteOpen(false)}>
                {t("Cancel")}
              </FcButton>
              <FcButton disabled={busy || pasteText.trim() === ""} onClick={() => void submitPaste()}>
                {busy ? t("Importing...") : t("Import")}
              </FcButton>
            </>
          }
        >
          <FcField label={t("Node links")}>
            <textarea
              rows={8}
              value={pasteText}
              placeholder="ss://...&#10;trojan://..."
              onChange={(event) => setPasteText(event.target.value)}
            />
          </FcField>
        </FcSheet>
      )}

      {editTag !== null && (
        <FcSheet
          title={t("Edit {name}", { name: editTag })}
          subtitle={t("Edit the sing-box outbound JSON directly; to rename, delete and recreate")}
          wide
          onClose={() => setEditTag(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setEditTag(null)}>
                {t("Cancel")}
              </FcButton>
              <FcButton disabled={busy} onClick={() => void saveEditor()}>
                {busy ? t("Saving...") : t("Save")}
              </FcButton>
            </>
          }
        >
          <FcField label={t("Node JSON")}>
            <textarea
              rows={16}
              value={editJson}
              spellCheck={false}
              onChange={(event) => setEditJson(event.target.value)}
            />
          </FcField>
        </FcSheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t("Delete node")}
          message={
            deleteTarget.origin === "managed"
              ? t(
                  "“{name}” comes from a subscription; deleting records an exclusion so it will not reappear on the next subscription update.",
                  { name: deleteTarget.tag },
                )
              : t("Delete “{name}”? Rules referencing it will fail validation.", { name: deleteTarget.tag })
          }
          confirmLabel={t("Delete")}
          danger
          busy={busy}
          onConfirm={() => void removeNode(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
