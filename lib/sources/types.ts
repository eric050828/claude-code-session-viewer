import type { ProjectMeta, SessionEvent, SessionMeta, SubagentMeta } from "../types";

export interface SessionSource {
  id: "claude" | "codex";
  listProjects(): Promise<ProjectMeta[]>;
  listSessions(rawProjectId: string): Promise<SessionMeta[]>;
  loadSession(rawProjectId: string, sessionId: string): Promise<SessionEvent[]>;
  listSubagents(rawProjectId: string, sessionId: string): Promise<SubagentMeta[]>;
}
