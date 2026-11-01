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
import { useStream } from "../../api/stream";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  FcButton,
  FcCard,
  FcField,
  FcIconButton,
  FcPageToolbar,
  FcRecordTable,
  FcSegmented,
  FcSelect,
  FcSheet,
  FcSparkline,
  type FcColumn,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { patchConfigText, readConfigValue } from "../../lib/configPatch";
import { urlTestDelayTone } from "../../api/format";
import { flagOfText } from "../../lib/flclash/country";
import { runDelayPool } from "../../lib/flclash/delayPool";
import styles from "../ops/ops.module.css";

type Tab = "list" | "latency";

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

function nodeDelay(delay: number, timeout: boolean) {
  if (delay > 0) {
    return <span className={urlTestDelayTone(delay)}>{delay} ms</span>;
  }
  return timeout ? "超时" : "—";
}

/** 节点：列表/延迟双视图、粘贴导入、编辑与删除。 */
export function NodesView() {
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
      setError("节点管理需要面板后端");
      return;
    }
    try {
      const [nextConfig, nextNodes, nextPolicies] = await Promise.all([
        getPanelConfig(),
        getNodes(),
        getPolicies(),
      ]);
      if (!nextConfig.ok) {
        throw new Error("读取配置失败");
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
  }, []);

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

  const writeOutbounds = useCallback(
    async (next: OutboundRecord[]) => {
      if (!config) {
        throw new Error("配置未就绪");
      }
      const text = patchConfigText(config.text, ["outbounds"], next);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || "配置校验失败，未应用");
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || "写入失败");
      }
      await afterConfigChange(api);
      await load();
    },
    [api, config, load],
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
        throw new Error(result.message || "订阅更新失败");
      }
      toast("订阅已更新", "good");
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
        throw new Error(parsed.message || "未解析出节点");
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
        throw new Error("解析出的节点名称均已存在");
      }
      await writeOutbounds(next);
      toast(`已添加 ${added} 个节点`, "good");
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
        throw new Error("读取节点失败");
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
        throw new Error("节点必须是 JSON 对象");
      }
      if (String(parsed.tag ?? "") !== editTag) {
        throw new Error("重命名节点会破坏规则引用，请先删除后新建");
      }
      const next = outbounds.map((item) => (item.tag === editTag ? parsed : item));
      await writeOutbounds(next);
      setEditTag(null);
      toast("节点已保存", "good");
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
      toast("节点已删除", "good");
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const columns: FcColumn<NodeRow>[] = [
    { key: "tag", label: "节点", flex: 2, render: (row) => `${flagOfText(row.tag)} ${row.tag}` },
    { key: "type", label: "类型", flex: 1, render: (row) => row.type },
    { key: "server", label: "服务器", flex: 2, hideBelow: 900, render: (row) => row.server || "—" },
    {
      key: "groups",
      label: "所属组",
      flex: 1,
      hideBelow: 760,
      render: (row) => (row.groups.length > 0 ? row.groups.slice(0, 2).join(" / ") : "—"),
    },
    {
      key: "delay",
      label: "延迟",
      width: 90,
      align: "end",
      render: (row) => nodeDelay(row.delay, false),
    },
    {
      key: "actions",
      label: "",
      width: 84,
      align: "end",
      render: (row) => (
        <>
          <FcIconButton label="编辑" onClick={() => void openEditor(row.tag)}>
            <Icon name="edit" size={16} />
          </FcIconButton>
          <FcIconButton label="删除" onClick={() => setDeleteTarget(row)}>
            <Icon name="delete" size={16} />
          </FcIconButton>
        </>
      ),
    },
  ];

  return (
    <div className="fc-page">
      <FcPageToolbar
        title="节点"
        subtitle={loading ? "加载中…" : `${filtered.length} / ${nodes.length} 个节点`}
        actions={
          <>
            <FcIconButton label="更新订阅" disabled={busy} onClick={() => void syncSubscriptions()}>
              <Icon name="sync" size={18} />
            </FcIconButton>
            <FcIconButton label="添加订阅" onClick={() => navigate("profiles")}>
              <Icon name="add" size={18} />
            </FcIconButton>
            <FcIconButton label="粘贴节点链接" onClick={() => setPasteOpen(true)}>
              <Icon name="link" size={18} />
            </FcIconButton>
            <FcIconButton label="全部测速" disabled={testing} onClick={() => void testAll()}>
              <Icon name="speed" size={18} />
            </FcIconButton>
          </>
        }
      />
      <div className="fc-page-body">
        <div className={styles.filters}>
          <FcSegmented
            ariaLabel="节点视图"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: "list", label: "列表" },
              { value: "latency", label: "延迟" },
            ]}
          />
          <label className={styles.addRow}>
            <Icon name="search" size={16} />
            <input
              value={search}
              placeholder="搜索节点"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <FcSelect value={groupFilter} onChange={setGroupFilter}>
            <option value="">全部组</option>
            {groupOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </FcSelect>
          <FcSelect value={protocolFilter} onChange={setProtocolFilter}>
            <option value="">全部协议</option>
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
          <div className={styles.empty}>加载中…</div>
        ) : tab === "list" ? (
          <FcCard>
            <FcRecordTable
              columns={columns}
              rows={filtered}
              getKey={(row) => row.tag}
              emptyLabel="暂无节点"
              maxRows={400}
            />
          </FcCard>
        ) : (
          <FcCard>
            <div className={styles.list}>
              {filtered.length === 0 && <div className={styles.empty}>暂无节点</div>}
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
                    <span className={styles.flowValue}>{nodeDelay(row.delay, false)}</span>
                  </div>
                );
              })}
            </div>
          </FcCard>
        )}
      </div>

      {pasteOpen && (
        <FcSheet
          title="粘贴节点链接"
          subtitle="支持 ss / vmess / vless / trojan / hysteria2 / tuic，一行一个"
          wide
          onClose={() => setPasteOpen(false)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setPasteOpen(false)}>
                取消
              </FcButton>
              <FcButton disabled={busy || pasteText.trim() === ""} onClick={() => void submitPaste()}>
                {busy ? "导入中…" : "导入"}
              </FcButton>
            </>
          }
        >
          <FcField label="节点链接">
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
          title={`编辑 ${editTag}`}
          subtitle="直接编辑 sing-box outbound JSON；改名请删除后新建"
          wide
          onClose={() => setEditTag(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setEditTag(null)}>
                取消
              </FcButton>
              <FcButton disabled={busy} onClick={() => void saveEditor()}>
                {busy ? "保存中…" : "保存"}
              </FcButton>
            </>
          }
        >
          <FcField label="节点 JSON">
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
          title="删除节点"
          message={
            deleteTarget.origin === "managed"
              ? `「${deleteTarget.tag}」来自订阅；删除后会记录排除，下次订阅更新不会再出现。`
              : `删除「${deleteTarget.tag}」？引用它的规则会校验失败。`
          }
          confirmLabel="删除"
          danger
          busy={busy}
          onConfirm={() => void removeNode(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
