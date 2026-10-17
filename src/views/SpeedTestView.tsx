import { useState } from "react";

import { proxyDisplayType, urlTestDelayTone } from "../api/format";
import { useStream } from "../api/stream";
import { navigate, useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { usePendingValue } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamStates } from "../components/StreamBanner";
import { Badge, Button, Card, IconButton, Spinner } from "../components/ui";
import { ServiceStatus_Type, type Group } from "../gen/daemon/started_service_pb";
import { cx } from "../lib/cx";
import styles from "./SpeedTestView.module.css";

export function SpeedTestView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);
  const service = useStream(api.serviceStatus);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const started = service.data.status?.status === ServiceStatus_Type.STARTED;

  const runOne = async (tag: string) => {
    setTesting(tag);
    try {
      await api.urlTest(tag);
    } catch (error) {
      showError(error);
    } finally {
      setTesting(null);
    }
  };

  const runAll = async () => {
    if (testingAll) {
      return;
    }
    setTestingAll(true);
    try {
      for (const group of groups.data.groups) {
        setTesting(group.tag);
        await api.urlTest(group.tag);
      }
    } catch (error) {
      showError(error);
    } finally {
      setTesting(null);
      setTestingAll(false);
    }
  };

  const nodeCount = groups.data.groups.reduce((total, group) => total + group.items.length, 0);

  return (
    <div className="page">
      <PageHeader
        title={t("Speed Test")}
        actions={
          <Button variant="primary" onClick={() => void runAll()} disabled={!started || testingAll}>
            {testingAll ? <Spinner /> : <Icon name="speed" />}
            全部测速
          </Button>
        }
      />

      <div className={styles.summary}>
        <Card title="策略组">
          <div className={styles.metric}>{groups.data.groups.length}</div>
        </Card>
        <Card title="节点">
          <div className={styles.metric}>{nodeCount}</div>
        </Card>
        <Card title="状态">
          <div className={styles.metricSmall}>
            {started ? <Badge tone="good">核心运行中</Badge> : <Badge tone="danger">核心未运行</Badge>}
          </div>
        </Card>
      </div>

      <StreamStates
        snapshot={groups}
        loaded={groups.data.loaded}
        empty={groups.data.groups.length === 0}
        emptyIcon="speed"
        emptyMessage="没有可测速的策略组"
      />

      <div className={styles.grid}>
        {groups.data.groups.map((group) => (
          <GroupTestCard
            key={group.tag}
            group={group}
            testing={testing === group.tag || testingAll}
            disabled={!started || testingAll}
            onTest={() => void runOne(group.tag)}
          />
        ))}
      </div>

      <div className={styles.advanced}>
        <Card
          icon="network_check"
          title="网络质量测试"
          actions={
            <Button size="small" onClick={() => navigate("tools/network-quality")}>
              打开
            </Button>
          }
        >
          <p className={styles.description}>下载 / 上传带宽、延迟与 RPM，使用原生 NetworkQualityTest。</p>
        </Card>
        <Card
          icon="route"
          title="STUN 测试"
          actions={
            <Button size="small" onClick={() => navigate("tools/stun")}>
              打开
            </Button>
          }
        >
          <p className={styles.description}>检测 NAT 类型、外部地址与映射行为。</p>
        </Card>
      </div>
    </div>
  );
}

function GroupTestCard(props: {
  group: Group;
  testing: boolean;
  disabled: boolean;
  onTest: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const group = props.group;
  const [selected, setPendingSelection] = usePendingValue(group.selected);

  const select = (tag: string) => {
    if (!group.selectable || tag === selected) {
      return;
    }
    setPendingSelection(tag);
    api.selectOutbound(group.tag, tag).catch((error: unknown) => {
      setPendingSelection(null);
      showError(error);
    });
  };

  return (
    <Card
      title={
        <span className={styles.groupTitle}>
          {group.tag}
          <span className={styles.groupType}>{proxyDisplayType(group.type)}</span>
        </span>
      }
      actions={
        <IconButton title={t("URL test")} onClick={props.onTest} disabled={props.disabled || props.testing}>
          {props.testing ? <Spinner /> : <Icon name="speed" />}
        </IconButton>
      }
    >
      <div className={styles.items}>
        {group.items.map((item) => {
          const delay = item.urlTestDelay;
          const tone = delay > 0 ? urlTestDelayTone(delay) : "";
          return (
            <button
              key={item.tag}
              type="button"
              className={cx(styles.item, item.tag === selected && styles.selected)}
              onClick={() => select(item.tag)}
              title={group.selectable ? "切换到该节点" : undefined}
            >
              <span className={styles.itemName}>{item.tag}</span>
              {item.tag === selected && <Badge tone="accent">当前</Badge>}
              <span className={cx(styles.delay, styles[tone])}>{delay > 0 ? `${delay}ms` : "—"}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
