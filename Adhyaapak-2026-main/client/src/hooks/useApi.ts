import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, api } from "../services/api";

export interface ApiState<T> {
  data: T | undefined;
  error: ApiRequestError | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads GET `path` and exposes loading / error / data. Pass null to skip loading.
 * `refreshMs` re-fetches quietly in the background (used for live classroom progress).
 */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiRequestError>();
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const { refreshMs } = opts;

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof ApiRequestError ? e : new ApiRequestError("internal_error", "Unexpected error", 0)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!refreshMs || path === null) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
