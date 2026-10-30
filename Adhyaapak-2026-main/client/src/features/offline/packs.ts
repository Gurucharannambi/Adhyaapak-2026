import type { OfflinePackDto } from "@adhyaapak/shared";
import { STORES, idbAll, idbDelete, idbGet, idbPut } from "./offline-db";

export const savePack = (pack: OfflinePackDto) => idbPut(STORES.packs, pack);
export const getLocalPack = (id: string) => idbGet<OfflinePackDto>(STORES.packs, id);
export const removePack = (id: string) => idbDelete(STORES.packs, id);
export async function listLocalPacks(): Promise<OfflinePackDto[]> {
  return (await idbAll<OfflinePackDto>(STORES.packs)).sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

export interface PreflightCheck {
  id: "lesson" | "questions" | "roster" | "shell" | "storage";
  ok: boolean;
  detail: string;
  /** Count of items, where it makes sense, for "pack ready, N items cached". */
  items?: number;
}

/** Roughly how much room a pack needs. Packs are text; this only guards against an almost-full device. */
export const estimatePackBytes = (pack: OfflinePackDto) => new Blob([JSON.stringify(pack)]).size;

/**
 * "Pack ready" check to run before leaving connectivity: is everything the lesson needs actually stored
 * on this device, and will the app itself open without a network?
 */
export async function preflight(pack: OfflinePackDto): Promise<PreflightCheck[]> {
  const stored = await getLocalPack(pack.id);
  const levels = stored?.presentation.levels.length ?? 0;
  const questions = stored?.questions.length ?? 0;
  const checks: PreflightCheck[] = [
    { id: "lesson", ok: levels > 0, items: levels, detail: levels > 0 ? `${levels} teaching level${levels === 1 ? "" : "s"} saved on this device` : "The lesson is not saved on this device." },
    { id: "questions", ok: questions > 0, items: questions, detail: questions > 0 ? `${questions} check question${questions === 1 ? "" : "s"} saved` : "No questions are saved." },
    { id: "roster", ok: (stored?.rollNumbers.length ?? 0) > 0, items: stored?.rollNumbers.length ?? 0, detail: (stored?.rollNumbers.length ?? 0) > 0 ? `${stored!.rollNumbers.length} roll numbers (no names are stored)` : "The class has no students." },
  ];

  let shell = false;
  try {
    shell = typeof caches !== "undefined" && !!(await caches.match("/"));
  } catch {
    shell = false;
  }
  checks.push({ id: "shell", ok: shell, detail: shell ? "The app itself will open without a connection" : "The app is not cached yet. Open it once while online (and let it finish loading), then check again." });

  const room = await storageRoom();
  checks.push({ id: "storage", ok: room.ok, detail: room.detail });
  return checks;
}

/** Warns before a download if the device is nearly out of space. Unknown is treated as fine, but said so. */
export async function storageRoom(neededBytes = 0): Promise<{ ok: boolean; detail: string }> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.quota === undefined || est.usage === undefined) return { ok: true, detail: "This browser does not say how much space is left." };
    const free = est.quota - est.usage;
    const mb = (n: number) => `${Math.max(0, Math.round(n / 1024 / 1024))} MB`;
    return free > Math.max(neededBytes * 5, 20 * 1024 * 1024) ? { ok: true, detail: `About ${mb(free)} free for offline use` } : { ok: false, detail: `Only about ${mb(free)} is free on this device. Free some space before downloading.` };
  } catch {
    return { ok: true, detail: "This browser does not say how much space is left." };
  }
}
