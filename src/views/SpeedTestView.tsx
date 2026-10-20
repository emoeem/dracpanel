import { useEffect, useRef, useState } from "react";

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
import { useToast } from "../components/Toast";
import { ServiceStatus_Type, type Group } from "../gen/daemon/started_service_pb";
import { cx } from "../lib/cx";
import styles from "./SpeedTestView.module.css";

// sing-box runs each URL test against the same core, so a high concurrency
// mostly adds contention. A small pool keeps the batch fast without
// overwhelming the daemon.
const TEST_CONCURRENCY = 6;

export function SpeedTestView() {
  const api = useApi();
  const { t } = useI18n();
  const showToast = useToast();
  const groups = useStream(api.groups);
  const service = useStream(api.serviceStatus);
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [testingAll, setTestingAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const started = service.data.status?.status === ServiceStatus_Type.STARTED;
  // Bump on each runAll() invocation so in-flight workers from an older run
  // (or an unmounting view) cannot overwrite newer state.
  const runIdRef = useRef(0);
  useEffect(() => {
    return () => {
      runIdRef.current = -1;
    };
  }, []);

  const setTagTesting = (tag: string, active: boolean) => {
    setTesting((current) => {
      const next = new Set(current);
      if (active) {
        next.add(tag);
      } else {
        next.delete(tag);
      }
      return next;
    });
  };

  const runOne = async (tag: string) => {
    setTagTesting(tag, true);
    try {
      await api.urlTest(tag);
    } catch (error) {
      showError(error);
    } finally {
      setTagTesting(tag, false);
    }
  };

  const runAll = async () => {
    if (testingAll) {
      return;
    }
    const tags = groups.data.groups.map((group) => group.tag);
    if (tags.length === 0) {
      return;
    }
    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;
    setTestingAll(true);
    setProgress({ done: 0, total: tags.length });

    const queue = [...tags];
    const failed: string[] = [];
    let done = 0;

    const worker = async () => {
      for (;;) {
        if (!isCurrent()) {
          return;
        }
        const tag = queue.shift();
        if (tag === undefined) {
          return;
        }
        if (!isCurrent()) {
          return;
        }
        setTagTesting(tag, true);
        try {
          await api.urlTest(tag);
        } catch {
          failed.push(tag);
        } finally {
          done += 1;
          if (isCurrent()) {
            setTagTesting(tag, false);
            setProgress({ done, total: tags.length });
          }
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(TEST_CONCURRENCY, tags.length) }, () => worker()),
      );
      if (!isCurrent()) {
        return;
      }
      if (failed.length > 0) {
        showToast(t("URL test failed for {tags}", { tags: failed.join(", ") }), "danger");
      } else {
        showToast(t("URL test complete"), "good");
      }
    } finally {
      if (isCurrent()) {
        setTestingAll(false);
        setProgress(null);
      }
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
            {progress !== null ? t("Testing {done} of {total}", progress) : t("URLTest All")}
          </Button>
        }
      />

      <div className={styles.summary}>
        <Card title={t("Policy groups")}>
          <div className={styles.metric}>{groups.data.groups.length}</div>
        </Card>
        <Card title={t("Node")}>
          <div className={styles.metric}>{nodeCount}</div>
        </Card>
        <Card title={t("Status")}>
          <div className={styles.metricSmall}>
            {started ? (
              <Badge tone="good">{t("Core running")}</Badge>
            ) : (
              <Badge tone="danger">{t("Core not running")}</Badge>
            )}
          </div>
        </Card>
      </div>

      <StreamStates
        snapshot={groups}
        loaded={groups.data.loaded}
        empty={groups.data.groups.length === 0}
        emptyIcon="speed"
        emptyMessage={t("No policy groups to test")}
      />

      <div className={styles.grid}>
        {groups.data.groups.map((group) => (
          <GroupTestCard
            key={group.tag}
            group={group}
            testing={testing.has(group.tag)}
            disabled={!started}
            onTest={() => void runOne(group.tag)}
          />
        ))}
      </div>

      <div className={styles.advanced}>
        <Card
          icon="network_check"
          title={t("Network quality test")}
          actions={
            <Button size="small" onClick={() => navigate("tools/network-quality")}>
              {t("Open")}
            </Button>
          }
        >
          <p className={styles.description}>
            {t("Download / upload bandwidth, latency and RPM, using the native NetworkQualityTest.")}
          </p>
        </Card>
        <Card
          icon="route"
          title={t("STUN Test")}
          actions={
            <Button size="small" onClick={() => navigate("tools/stun")}>
              {t("Open")}
            </Button>
          }
        >
          <p className={styles.description}>{t("Detects NAT type, external address and mapping behavior.")}</p>
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
              title={group.selectable ? t("Switch to this node") : undefined}
              aria-pressed={item.tag === selected}
            >
              <span className={styles.itemName}>{item.tag}</span>
              {item.tag === selected && <Badge tone="accent">{t("Current")}</Badge>}
              <span className={cx(styles.delay, styles[tone])}>{delay > 0 ? `${delay}ms` : "—"}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
