import type { Request, Response } from "express";

/**
 * Live updates for a classroom, pushed over Server-Sent Events.
 *
 * Events are only signals ("something changed"), never data: the page that receives one asks the normal, permission-checked
 * API for the new state. That keeps one source of truth, and means a signal can never leak a student's answer or name.
 *
 * The hub lives in this process, so it serves one server instance. Running several would need a shared channel
 * (for example Postgres LISTEN/NOTIFY) behind the same publish/subscribe functions; callers would not change.
 */
export type LiveKind =
  | "answers" // a student's answers were saved (by the student or keyed in by the teacher)
  | "joined" // a student joined the class on a device
  | "opened" // the check was opened
  | "closed" // the check was closed
  | "released" // the teacher let students see their results
  | "poll_opened" // a quick poll was opened
  | "poll_closed" // the quick poll was closed
  | "poll_vote" // a student answered the poll (teacher-only signal)
  | "paused" // the teacher paused the running check
  | "resumed"; // the teacher resumed it

export interface LiveEvent {
  kind: LiveKind;
  assessmentId?: string;
}

type Listener = (e: LiveEvent) => void;
const listeners = new Map<string, Set<Listener>>();

/** Tell everyone watching this class that something changed. Never throws: a broken listener must not break a request. */
export function publish(classId: string, event: LiveEvent): void {
  for (const fn of listeners.get(classId) ?? []) {
    try {
      fn(event);
    } catch {
      // a dead connection is cleaned up when it closes
    }
  }
}

export function subscribe(classId: string, fn: Listener): () => void {
  const set = listeners.get(classId) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(classId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(classId);
  };
}

export const watcherCount = (classId: string): number => listeners.get(classId)?.size ?? 0;

const HEARTBEAT_MS = 25_000;

/**
 * Opens an event stream for a class. `allow` lets a caller leave some kinds out (a student is told that the check opened
 * or closed, never that a classmate answered).
 */
export function openStream(req: Request, res: Response, classId: string, allow?: ReadonlySet<LiveKind>): void {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  res.write(`event: ready\ndata: {}\n\n`);

  const unsubscribe = subscribe(classId, (e) => {
    if (allow && !allow.has(e.kind)) return;
    res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
  });
  // A comment line keeps proxies from closing a quiet connection.
  const beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
}
