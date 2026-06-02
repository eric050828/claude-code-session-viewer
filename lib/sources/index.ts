import type {
  ProjectMeta,
  SessionEvent,
  SessionMeta,
  SourceId,
  SubagentMeta,
} from "../types";
import { claudeSource } from "./claude";
import type { SessionSource } from "./types";
import {
  listCodexProjects,
  listCodexSessions,
  loadCodexSession,
} from "../codex-loader";

const CODEX_PREFIX = "codex:";

export function encodeProjectId(source: SourceId, rawId: string): string {
  return source === "codex" ? `${CODEX_PREFIX}${rawId}` : rawId;
}

export function decodeProjectId(id: string): { source: SourceId; rawId: string } {
  if (id.startsWith(CODEX_PREFIX)) {
    return { source: "codex", rawId: id.slice(CODEX_PREFIX.length) };
  }
  return { source: "claude", rawId: id };
}

const codexSource: SessionSource = {
  id: "codex",
  listProjects: listCodexProjects,
  listSessions: listCodexSessions,
  loadSession: loadCodexSession,
  listSubagents: async () => [],
};

function sourceFor(source: SourceId): SessionSource {
  return source === "codex" ? codexSource : claudeSource;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const [claude, codex] = await Promise.all([
    claudeSource.listProjects(),
    codexSource.listProjects(),
  ]);
  return [
    ...claude.map((p) => ({ ...p, id: encodeProjectId("claude", p.id) })),
    ...codex.map((p) => ({ ...p, id: encodeProjectId("codex", p.id) })),
  ];
}

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  const { source, rawId } = decodeProjectId(projectId);
  const sessions = await sourceFor(source).listSessions(rawId);
  return sessions.map((s) => ({ ...s, projectId, source }));
}

export async function loadSession(
  projectId: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  const { source, rawId } = decodeProjectId(projectId);
  return sourceFor(source).loadSession(rawId, sessionId);
}

export async function listSubagents(
  projectId: string,
  sessionId: string,
): Promise<SubagentMeta[]> {
  const { source, rawId } = decodeProjectId(projectId);
  return sourceFor(source).listSubagents(rawId, sessionId);
}
