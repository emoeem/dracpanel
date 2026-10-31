import { useState } from "react";

import { proxyDisplayType } from "../../api/format";
import { useApi } from "../../app/context";
import { showError } from "../../app/errorStore";
import { FcSheet } from "../../components/flclash";
import type { Group } from "../../gen/daemon/started_service_pb";
import { ProxyNodeCard } from "./ProxyNodeCard";
import styles from "./ProxyGroupSheet.module.css";

interface ProxyGroupSheetProps {
  group: Group;
  onClose: () => void;
}

/** FlClash opens the selected group's nodes in a sheet from the dashboard. */
export function ProxyGroupSheet({ group, onClose }: ProxyGroupSheetProps) {
  const api = useApi();
  const [pending, setPending] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const selected = pending ?? group.selected;

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

  const test = (tag: string) => {
    setTesting(tag);
    api
      .urlTest(tag)
      .catch(showError)
      .finally(() => setTesting(null));
  };

  return (
    <FcSheet
      title={group.tag}
      subtitle={`${proxyDisplayType(group.type)} · ${group.items.length} 个节点`}
      onClose={onClose}
      wide
    >
      <div className={styles.grid}>
        {group.items.map((item, index) => (
          <ProxyNodeCard
            key={item.tag}
            item={item}
            index={index}
            selected={item.tag === selected}
            selectable={group.selectable}
            testing={testing === item.tag}
            onSelect={() => select(item.tag)}
            onTest={() => test(item.tag)}
          />
        ))}
      </div>
    </FcSheet>
  );
}
