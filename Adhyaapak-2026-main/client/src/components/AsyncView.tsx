import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApiState } from "../hooks/useApi";

/** Standard loading / error / retry states so every screen handles them the same way (CLAUDE.md §15). */
export function AsyncView<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  if (state.loading && state.data === undefined)
    return (
      <p className="state-loading" role="status">
        {t("common.loading")}
      </p>
    );
  if (state.error) {
    const known = ["unauthenticated", "forbidden", "network_error", "offline", "rate_limited"].includes(state.error.code);
    return (
      <div className="state-error" role="alert">
        <p>
          <strong>{known ? t(`errors.${state.error.code}`) : state.error.message}</strong>
        </p>
        <p>
          <button className="btn btn-sm" onClick={state.reload}>
            {t("common.retry")}
          </button>
        </p>
      </div>
    );
  }
  if (state.data === undefined) return null;
  return <>{children(state.data)}</>;
}
