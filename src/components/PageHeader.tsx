import type { ReactNode } from "react";

import { Icon } from "./Icon";

export function PageHeader(props: {
  title: ReactNode;
  actions?: ReactNode;
  back?: { label: string; onClick: () => void };
}) {
  return (
    <div className="page-header">
      {props.back !== undefined && (
        <button type="button" className="back-button" aria-label={props.back.label} onClick={props.back.onClick}>
          <Icon name="arrow_back" size={20} />
        </button>
      )}
      <h1 className="page-title">{props.title}</h1>
      {props.actions !== undefined && <div className="actions">{props.actions}</div>}
    </div>
  );
}
