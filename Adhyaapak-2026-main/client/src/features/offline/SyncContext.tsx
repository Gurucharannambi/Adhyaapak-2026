import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SyncOperation, SyncResponse } from "@adhyaapak/shared";
import { api } from "../../services/api";
import { queueCounts, syncQueue, type SyncOutcome } from "./queue";

interface SyncState {
  online: boolean;
  /** Recorded on this device, not yet acknowledged by the server. */
  pending: number;
  /** Refused by the server; waiting for the teacher to read and dismiss. */
  rejected: number;
  syncing: boolean;
  last: SyncOutcome | undefined;
  syncNow: () => Promise<void>;
  /** Re-reads the queue (after recording or dismissing something). */
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

const send = (operations: SyncOperation[]) => api<SyncResponse>("/sync/operations", { method: "POST", body: { operations } });

/**
 * Keeps the "unsynced work" count current and syncs by itself when the connection returns, and every
 * half minute while work is waiting. The count is shown on every screen so unsynced work is never out of sight.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [browserOnline, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  // A browser only knows its network card is up. A failed sync tells us the server itself cannot be reached.
  const [unreachable, setUnreachable] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<SyncOutcome>();
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const c = await queueCounts();
      if (alive.current) setCounts(c);
    } catch {
      // Offline storage unavailable (private window, blocked data): nothing can be queued either.
    }
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const outcome = await syncQueue(send);
      if (alive.current) {
        setLast(outcome);
        setUnreachable(outcome.stoppedBecause === "offline");
      }
    } catch {
      // storage problems are surfaced by the pages that record work
    } finally {
      if (alive.current) setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const goOnline = () => {
      setOnline(true);
      setUnreachable(false);
      void syncNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      alive.current = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh, syncNow]);

  // Try again every 30 seconds while work is waiting and we believe we are online.
  useEffect(() => {
    if (counts.pending === 0 || !browserOnline) return;
    const id = setInterval(() => void syncNow(), 30_000);
    return () => clearInterval(id);
  }, [counts.pending, browserOnline, syncNow]);

  // Sync once on start if something was left from last time.
  useEffect(() => {
    if (counts.pending > 0 && online && !last && !syncing) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.pending > 0]);

  const online = browserOnline && !unreachable;
  const value = useMemo(() => ({ online, pending: counts.pending, rejected: counts.rejected, syncing, last, syncNow, refresh }), [online, counts, syncing, last, syncNow, refresh]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}

/** Always-visible status: connection and unsynced work. */
export function SyncBadge({ label }: { label: (state: { online: boolean; pending: number; rejected: number; syncing: boolean }) => string }) {
  const s = useSync();
  return (
    <span role="status" aria-live="polite" data-testid="sync-badge">
      {label(s)}
    </span>
  );
}
