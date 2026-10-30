import type { SyncOperation, SyncResponse } from "@adhyaapak/shared";
import { ApiRequestError } from "../../services/api";
import { STORES, idbAdd, idbAll, idbDelete, idbPut } from "./offline-db";

/**
 * The durable operation queue. Only operations of a defined type are ever queued (see OPERATION_TYPES),
 * each carries an idempotency key and the version of the pack it was recorded against, and students are
 * roll numbers, never names. Work stays queued until the server acknowledges it.
 */
export interface QueuedOperation {
  operation: SyncOperation;
  /** Order of recording. Operations are sent in this order. */
  seq: number;
  state: "pending" | "rejected";
  /** Why the server refused it (for `rejected`). */
  message?: string;
  attempts: number;
  lastTriedAt?: string;
}

let counter = 0;
const nextSeq = () => Date.now() * 1000 + (counter++ % 1000);

export const newOperationKey = () => `op-${crypto.randomUUID()}`;

/** Adds an operation. Adding the same key twice keeps the first copy, so a double click cannot queue two records. */
export async function enqueue(operation: SyncOperation): Promise<QueuedOperation> {
  const item: QueuedOperation = { operation, seq: nextSeq(), state: "pending", attempts: 0 };
  try {
    await idbAdd(STORES.queue, item);
  } catch {
    // Already queued under this key: leave the original untouched.
  }
  return item;
}

export async function listQueue(): Promise<QueuedOperation[]> {
  return (await idbAll<QueuedOperation>(STORES.queue)).sort((a, b) => a.seq - b.seq);
}

export async function queueCounts(): Promise<{ pending: number; rejected: number }> {
  const all = await listQueue();
  return { pending: all.filter((q) => q.state === "pending").length, rejected: all.filter((q) => q.state === "rejected").length };
}

/** Removes a refused operation the teacher has read and dealt with. Pending work cannot be dismissed here. */
export async function dismissRejected(key: string): Promise<void> {
  const item = (await listQueue()).find((q) => q.operation.idempotencyKey === key);
  if (item?.state === "rejected") await idbDelete(STORES.queue, key);
}

export type StoppedBecause = "offline" | "signed_out" | "server_error";
export interface SyncOutcome {
  sent: number;
  applied: number;
  duplicates: number;
  /** Sent and held by the server for the teacher to resolve. They leave the local queue (the server keeps them). */
  conflicts: number;
  rejected: number;
  /** Set when the run stopped early. Everything not acknowledged stays queued. */
  stoppedBecause?: StoppedBecause;
}

let running: Promise<SyncOutcome> | undefined;

/**
 * Sends pending operations, oldest first, in small batches. After each batch, only operations the server
 * acknowledged leave the queue. If the connection drops (or the app is closed) mid-way, nothing is lost and
 * nothing is double-applied: unacknowledged operations are simply sent again and the server recognises their keys.
 */
export function syncQueue(send: (operations: SyncOperation[]) => Promise<SyncResponse>, batchSize = 20): Promise<SyncOutcome> {
  if (running) return running; // one run at a time per tab; the server's idempotency covers other tabs
  running = run(send, batchSize).finally(() => {
    running = undefined;
  });
  return running;
}

async function run(send: (operations: SyncOperation[]) => Promise<SyncResponse>, batchSize: number): Promise<SyncOutcome> {
  const out: SyncOutcome = { sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0 };
  const pending = (await listQueue()).filter((q) => q.state === "pending");

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let response: SyncResponse;
    try {
      response = await send(batch.map((b) => b.operation));
    } catch (err) {
      const now = new Date().toISOString();
      await Promise.all(batch.map((b) => idbPut(STORES.queue, { ...b, attempts: b.attempts + 1, lastTriedAt: now })));
      out.stoppedBecause = err instanceof ApiRequestError && (err.code === "network_error" || err.code === "offline") ? "offline" : err instanceof ApiRequestError && err.code === "unauthenticated" ? "signed_out" : "server_error";
      return out;
    }

    const byKey = new Map(response.results.map((r) => [r.idempotencyKey, r]));
    for (const item of batch) {
      const result = byKey.get(item.operation.idempotencyKey);
      if (!result) {
        // The server did not mention it: keep it and try again next time.
        await idbPut(STORES.queue, { ...item, attempts: item.attempts + 1, lastTriedAt: new Date().toISOString() });
        continue;
      }
      out.sent++;
      if (result.status === "rejected") {
        out.rejected++;
        await idbPut(STORES.queue, { ...item, state: "rejected", message: result.message, attempts: item.attempts + 1, lastTriedAt: new Date().toISOString() });
        continue;
      }
      if (result.status === "applied") out.applied++;
      else if (result.status === "duplicate") out.duplicates++;
      else out.conflicts++;
      await idbDelete(STORES.queue, item.operation.idempotencyKey);
    }
  }
  return out;
}
