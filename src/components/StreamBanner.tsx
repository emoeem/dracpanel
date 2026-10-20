import { isTerminalCode, type StreamSnapshot } from "../api/stream";
import { useStreamOutage } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "./Icon";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./ui";

export function StreamErrorBanner(props: { error: string | null; onRetry?: () => void }) {
  const { t } = useI18n();
  if (props.error === null) {
    return null;
  }
  return (
    <div className="banner error">
      <Icon name="warning_amber" />
      <div>{props.error}</div>
      {props.onRetry && (
        <button type="button" className="banner-retry" onClick={props.onRetry}>
          <Icon name="sync" />
          <span>{t("Retry")}</span>
        </button>
      )}
    </div>
  );
}

export function StreamBanner(props: { snapshot: StreamSnapshot<unknown> }) {
  const outage = useStreamOutage(props.snapshot, isTerminalCode(props.snapshot.errorCode));
  return <StreamErrorBanner error={outage} />;
}

export function StreamStates(props: {
  snapshot: StreamSnapshot<unknown>;
  loaded: boolean;
  empty: boolean;
  emptyIcon?: IconName;
  emptyMessage: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const outage = useStreamOutage(props.snapshot, isTerminalCode(props.snapshot.errorCode));
  return (
    <>
      <StreamErrorBanner error={outage} onRetry={props.onRetry} />
      {!props.loaded && outage === null && (
        <div role="status">
          <SkeletonLines />
          <span className="sr-only">{t("Loading...")}</span>
        </div>
      )}
      {props.loaded && props.empty && (
        <EmptyState icon={props.emptyIcon}>{props.emptyMessage}</EmptyState>
      )}
    </>
  );
}
