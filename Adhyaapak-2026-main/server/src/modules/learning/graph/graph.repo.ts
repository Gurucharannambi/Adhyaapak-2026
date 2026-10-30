import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { conceptPrerequisites, concepts } from "../../../db/schema";
import { ConceptGraph } from "./graph";

/** Loads the approved prerequisite graph of one curriculum version, in curriculum order. */
export async function loadConceptGraph(db: Db, curriculumVersionId: string): Promise<ConceptGraph> {
  const nodes = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.curriculumVersionId, curriculumVersionId))
    .orderBy(asc(concepts.chapterId), asc(concepts.conceptOrder));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = await db.select().from(conceptPrerequisites);
  return new ConceptGraph(
    nodes.map((n) => n.id),
    edges
      .filter((e) => e.reviewStatus === "approved" && ids.has(e.dependentConceptId) && ids.has(e.prerequisiteConceptId))
      .map((e) => ({ prerequisiteId: e.prerequisiteConceptId, dependentId: e.dependentConceptId })),
  );
}
