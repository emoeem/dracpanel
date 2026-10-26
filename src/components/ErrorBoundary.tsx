import { Component, type ErrorInfo, type ReactNode } from "react";

import { navigate } from "../app/context";
import { useI18n } from "../app/i18n";
import { reportError } from "../lib/errorReporting";
import { Button } from "./ui";
import styles from "./ErrorBoundary.module.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { where: "ErrorBoundary", extra: { componentStack: info.componentStack } });
  }

  render() {
    const error = this.state.error;
    if (error !== null) {
      return <ErrorFallback error={error} onReset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function ErrorFallback(props: { error: Error; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.fallback} role="alert">
      <h2 className={styles.title}>{t("Something went wrong")}</h2>
      <p className={styles.message}>{props.error.message || String(props.error)}</p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={props.onReset}>
          {t("Try again")}
        </Button>
        <Button
          onClick={() => {
            props.onReset();
            navigate("dashboard");
          }}
        >
          {t("Go to Overview")}
        </Button>
      </div>
    </div>
  );
}
