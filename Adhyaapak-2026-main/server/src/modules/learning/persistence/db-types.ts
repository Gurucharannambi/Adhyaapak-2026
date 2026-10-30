import type { Db } from "../../../db/client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Exec = Db | Tx;

export const pgCode = (e: unknown): string | undefined => (typeof e === "object" && e ? (e as { code?: string }).code : undefined);

/** Drizzle wraps driver errors, so the Postgres code may be on `cause`. */
export const isUniqueViolation = (e: unknown): boolean => pgCode(e) === "23505" || pgCode((e as { cause?: unknown } | null)?.cause) === "23505";
