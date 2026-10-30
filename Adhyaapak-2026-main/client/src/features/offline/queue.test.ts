import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SyncOperation, SyncResponse } from "@adhyaapak/shared";
import { ApiRequestError } from "../../services/api";
import { STORES, idbAll, resetOfflineDbConnection } from "./offline-db";
import { dismissRejected, enqueue, listQueue, queueCounts, syncQueue } from "./queue";

const Q = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";

const op = (n: number): SyncOperation => ({
  idempotencyKey: `op-key-${String(n).padStart(4, "0")}`,
  type: "record_responses",
  baseVersion: "v1",
  recordedAt: "2026-10-28T09:00:00.000Z",
  payload: { assessmentId: A, rosterNumber: n, responses: [{ questionId: Q, answer: { kind: "option", optionId: "b" } }] },
});

const ok = (ops: SyncOperation[], status: "applied" | "duplicate" | "conflict" | "rejected" = "applied"): SyncResponse => ({
  results: ops.map((o) => ({ idempotencyKey: o.idempotencyKey, status, ...(status === "rejected" ? { message: "No such roll number." } : {}) })),
});
const offline = () => new ApiRequestError("network_error", "Network request failed", 0);

beforeEach(async () => {
  await resetOfflineDbConnection();
  // Clear every record between tests.
  for (const q of await listQueue()) await (await import("./offline-db")).idbDelete(STORES.queue, q.operation.idempotencyKey);
});

describe("offline queue", () => {
  it("keeps recorded work durably, in the order it was recorded, with no student names", async () => {
    for (const n of [3, 1, 2]) await enqueue(op(n));
    await resetOfflineDbConnection(); // as if the tab was closed and reopened
    const q = await listQueue();
    expect(q.map((x) => x.operation.payload.rosterNumber)).toEqual([3, 1, 2]);
    expect(q.every((x) => x.state === "pending")).toBe(true);
    expect(JSON.stringify(await idbAll(STORES.queue))).not.toMatch(/name/i);
    expect(await queueCounts()).toEqual({ pending: 3, rejected: 0 });
  });

  it("queuing the same key twice keeps one record", async () => {
    await enqueue(op(1));
    await enqueue(op(1));
    expect(await listQueue()).toHaveLength(1);
  });

  it("removes only what the server acknowledged", async () => {
    for (const n of [1, 2, 3]) await enqueue(op(n));
    const sent: string[][] = [];
    const out = await syncQueue(async (ops) => (sent.push(ops.map((o) => o.idempotencyKey)), ok(ops)));
    expect(out).toMatchObject({ sent: 3, applied: 3 });
    expect(sent).toEqual([["op-key-0001", "op-key-0002", "op-key-0003"]]);
    expect(await listQueue()).toHaveLength(0);
  });

  it("stops when the connection drops mid-way, keeps the rest, and finishes next time", async () => {
    for (const n of [1, 2, 3, 4]) await enqueue(op(n));
    let batches = 0;
    const flaky = async (ops: SyncOperation[]) => {
      if (++batches === 2) throw offline();
      return ok(ops);
    };
    const first = await syncQueue(flaky, 2);
    expect(first).toMatchObject({ applied: 2, stoppedBecause: "offline" });
    const left = await listQueue();
    expect(left.map((x) => x.operation.payload.rosterNumber)).toEqual([3, 4]);
    expect(left.every((x) => x.state === "pending" && x.attempts === 1)).toBe(true);

    const second = await syncQueue(async (ops) => ok(ops), 2);
    expect(second).toMatchObject({ applied: 2 });
    expect(await listQueue()).toHaveLength(0);
  });

  it("a lost reply is harmless: the server already applied it, the resend comes back as a duplicate", async () => {
    await enqueue(op(1));
    const serverApplied = new Set<string>();
    const lostReply = async (ops: SyncOperation[]): Promise<SyncResponse> => {
      for (const o of ops) serverApplied.add(o.idempotencyKey); // applied on the server...
      throw offline(); // ...but the answer never reached the device
    };
    expect((await syncQueue(lostReply)).stoppedBecause).toBe("offline");
    expect(await listQueue()).toHaveLength(1);

    const server = async (ops: SyncOperation[]): Promise<SyncResponse> => ({
      results: ops.map((o) => ({ idempotencyKey: o.idempotencyKey, status: serverApplied.has(o.idempotencyKey) ? ("duplicate" as const) : ("applied" as const) })),
    });
    expect(await syncQueue(server)).toMatchObject({ duplicates: 1, applied: 0 });
    expect(await listQueue()).toHaveLength(0);
  });

  it("keeps a refused operation visible until the teacher dismisses it, and never resends it", async () => {
    await enqueue(op(7));
    await enqueue(op(1));
    const out = await syncQueue(async (ops) => ({ results: ops.map((o) => ({ idempotencyKey: o.idempotencyKey, status: o.payload.rosterNumber === 7 ? ("rejected" as const) : ("applied" as const), message: "No such roll number." })) }));
    expect(out).toMatchObject({ applied: 1, rejected: 1 });
    const [refused] = await listQueue();
    expect(refused).toMatchObject({ state: "rejected", message: "No such roll number." });
    expect(await queueCounts()).toEqual({ pending: 0, rejected: 1 });

    let calls = 0;
    await syncQueue(async (ops) => (calls++, ok(ops)));
    expect(calls).toBe(0);

    await dismissRejected(refused!.operation.idempotencyKey);
    expect(await listQueue()).toHaveLength(0);
  });

  it("hands conflicts to the server's inbox and drops them locally; pending work cannot be dismissed", async () => {
    await enqueue(op(1));
    await enqueue(op(2));
    await dismissRejected("op-key-0002");
    expect(await listQueue()).toHaveLength(2);
    const out = await syncQueue(async (ops) => ok(ops, "conflict"));
    expect(out).toMatchObject({ conflicts: 2 });
    expect(await listQueue()).toHaveLength(0);
  });

  it("keeps everything when signed out or when the server errors", async () => {
    await enqueue(op(1));
    expect((await syncQueue(async () => { throw new ApiRequestError("unauthenticated", "Please sign in", 401); })).stoppedBecause).toBe("signed_out");
    expect((await syncQueue(async () => { throw new ApiRequestError("internal_error", "boom", 500); })).stoppedBecause).toBe("server_error");
    expect((await listQueue())[0]).toMatchObject({ state: "pending", attempts: 2 });
  });

  it("keeps an operation the server did not mention", async () => {
    await enqueue(op(1));
    await syncQueue(async () => ({ results: [] }));
    expect((await listQueue())[0]).toMatchObject({ state: "pending", attempts: 1 });
  });

  it("two overlapping syncs share one run", async () => {
    await enqueue(op(1));
    let calls = 0;
    const slow = async (ops: SyncOperation[]) => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return ok(ops);
    };
    const [a, b] = await Promise.all([syncQueue(slow), syncQueue(slow)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});
