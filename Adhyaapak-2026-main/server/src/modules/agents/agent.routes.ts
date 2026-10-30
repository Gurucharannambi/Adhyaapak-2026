import { Router } from "express";
import { AgentDecisionRequest, AgentKind, StartAgentRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import type { LlmProvider } from "../ai/provider";
import { decideAgentRun, getAgentRun, latestAgentRun, startAgent } from "./agent.service";

/** Agentic workflows: start a run, follow its trace, and approve or reject its plan. Teacher-only. */
export function agentRoutes(db: Db, ai: LlmProvider): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);

  router.post("/agents/:agent/runs", teacherOnly, async (req, res) => {
    const kind = parseOrThrow(AgentKind, req.params.agent);
    const input = parseOrThrow(StartAgentRequest, req.body);
    res.status(202).json(await startAgent(db, ai, req.user!, kind, input, p(req.id)));
  });
  router.get("/agent-runs/:runId", teacherOnly, async (req, res) => {
    res.json(await getAgentRun(db, req.user!, p(req.params.runId)));
  });
  router.post("/agent-runs/:runId/decision", teacherOnly, async (req, res) => {
    const { decision } = parseOrThrow(AgentDecisionRequest, req.body);
    res.json(await decideAgentRun(db, req.user!, p(req.params.runId), decision, p(req.id)));
  });
  router.get("/classes/:classId/agents/:agent/latest", teacherOnly, async (req, res) => {
    const kind = parseOrThrow(AgentKind, req.params.agent);
    const q = req.query as Record<string, string | undefined>;
    res.json({ run: await latestAgentRun(db, req.user!, p(req.params.classId), kind, { conceptId: q.conceptId, patternId: q.patternId }) });
  });
  return router;
}
