import type { Db } from "../../db/client";
import { auditLog } from "../../db/schema";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Keep this small and free of passwords, tokens and student submissions. */
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/** Append-only. There is intentionally no update or delete function. */
export async function recordAudit(db: Pick<Db, "insert">, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? null,
    requestId: entry.requestId ?? null,
  });
}
