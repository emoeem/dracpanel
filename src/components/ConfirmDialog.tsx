import { useI18n } from "../app/i18n";
import { Button, Dialog, Spinner } from "./ui";

export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog onClose={() => (props.busy ? undefined : props.onClose())}>
      <h3>{props.title}</h3>
      <p className="dialog-message">{props.message}</p>
      <div className="row-actions dialog-actions">
        <Button onClick={props.onClose} disabled={props.busy}>
          {t("Cancel")}
        </Button>
        <Button
          variant={props.danger ? "danger" : "primary"}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? <Spinner /> : props.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
