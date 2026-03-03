"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/lib/logger";

type Props = {
  children: ReactNode;
  /** Optional fallback UI. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("React ErrorBoundary caught error", error, {
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    return (
      <div
        style={{
          padding: "24px",
          margin: "16px",
          border: "1px solid #ef4444",
          borderRadius: "8px",
          backgroundColor: "#fef2f2",
        }}
      >
        <h3 style={{ margin: "0 0 8px", color: "#dc2626", fontSize: "16px" }}>
          오류가 발생했습니다
        </h3>
        <p style={{ margin: "0 0 12px", color: "#7f1d1d", fontSize: "14px" }}>
          {error.message}
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          style={{
            padding: "6px 16px",
            fontSize: "13px",
            backgroundColor: "#dc2626",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }
}
