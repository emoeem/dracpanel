import { useState } from "react";

import { createServerId, normalizeServerUrl, type Server } from "../api/config";
import { useI18n } from "../app/i18n";
import { ReachabilityIndicator, useServerReachability } from "../components/ReachabilityIndicator";
import { Button, Dialog, Field, SecretInput } from "../components/ui";

// Kept in its own module so `ConnectionErrorView` can load it lazily: importing
// it from `SettingsView` dragged the whole 288 kB settings chunk into the first
// paint for a dialog that only opens on user action.
export function ServerDialog(props: {
  server: Server | null;
  canDelete: boolean;
  onSave: (server: Server) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(props.server?.name ?? "");
  const [url, setUrl] = useState(props.server?.url ?? "");
  const [secret, setSecret] = useState(props.server?.secret ?? "");
  const reachability = useServerReachability(url, secret);

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  return (
    <Dialog onClose={props.onClose}>
      <h3>{props.server ? t("Edit Server") : t("New Server")}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) {
            return;
          }
          props.onSave({
            id: props.server?.id ?? createServerId(),
            name: name.trim(),
            url: normalizedUrl,
            secret,
          });
        }}
      >
        <Field label={t("Name")}>
          <input
            className="input"
            value={name}
            placeholder={t("Optional")}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("URL")}>
          <input
            className="input"
            value={url}
            placeholder={t("Required")}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field label={t("Secret")}>
          <SecretInput value={secret} placeholder={t("Optional")} onChange={setSecret} />
        </Field>
        <ReachabilityIndicator reachability={reachability} url={url} />
        <div className="row-actions dialog-actions">
          {props.server && props.canDelete && (
            <Button
              variant="danger"
              style={{ marginInlineEnd: "auto" }}
              onClick={() => props.onDelete(props.server!.id)}
            >
              {t("Delete")}
            </Button>
          )}
          <Button onClick={props.onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" disabled={!valid}>
            {t("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
