/**
 * When a teacher approves a newer explanation for a teaching level, that one is shown. Older approved
 * ones stay in the database (nothing is deleted) but are not displayed. Resources without a level
 * (teacher notes) are all kept.
 */
export function latestPerLevel<T extends { level: string | null; type: string; createdAt: Date }>(resources: readonly T[]): T[] {
  const newest = new Map<string, T>();
  for (const r of resources) {
    if (r.type !== "explanation" || r.level === null) continue;
    const current = newest.get(r.level);
    if (!current || r.createdAt > current.createdAt) newest.set(r.level, r);
  }
  return resources.filter((r) => r.type !== "explanation" || r.level === null || newest.get(r.level) === r);
}
