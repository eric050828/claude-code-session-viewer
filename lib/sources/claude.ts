import {
  listProjects,
  listSessions,
  loadSession,
  listSubagents,
} from "../session-loader";
import type { SessionSource } from "./types";

export const claudeSource: SessionSource = {
  id: "claude",
  listProjects,
  listSessions,
  loadSession,
  listSubagents,
};
