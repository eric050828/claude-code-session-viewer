"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectTree } from "./project-tree";
import { SessionList } from "./session-list";
import { ConversationView } from "./conversation-view";
import { DetailPane } from "./detail-pane";
import { TopBar } from "./top-bar";
import { SearchDialog } from "./search-dialog";
import type {
  ProjectMeta,
  SessionMeta,
  SessionEvent,
  SubagentMeta,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DetailContent {
  kind: "tool" | "subagent";
  title: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolResultIsError?: boolean;
  toolUseResult?: unknown;
  subagent?: {
    projectId: string;
    sessionId: string;
    agentId: string;
  };
}

export function AppShell({ initialProjects }: { initialProjects: ProjectMeta[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    initialProjects[0]?.id ?? null,
  );
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [subagents, setSubagents] = useState<SubagentMeta[]>([]);
  const [detail, setDetail] = useState<DetailContent | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  const reloadProjects = useCallback(async () => {
    const r = await fetch("/api/projects");
    if (r.ok) {
      const j = await r.json();
      setProjects(j.projects);
    }
  }, []);

  // load sessions when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    fetch(`/api/sessions/${activeProjectId}`)
      .then((r) => r.json())
      .then((j) => setSessions(j.sessions || []))
      .finally(() => setLoadingSessions(false));
  }, [activeProjectId]);

  // load events when active session changes
  useEffect(() => {
    if (!activeProjectId || !activeSessionId) {
      setEvents([]);
      setSubagents([]);
      return;
    }
    setLoadingSession(true);
    fetch(`/api/session/${activeProjectId}/${activeSessionId}`)
      .then((r) => r.json())
      .then((j) => {
        setEvents(j.events || []);
        setSubagents(j.subagents || []);
      })
      .finally(() => setLoadingSession(false));
  }, [activeProjectId, activeSessionId]);

  // SSE live updates for active session
  useEffect(() => {
    if (!activeProjectId || !activeSessionId) return;
    const url = `/api/stream/${activeProjectId}/${activeSessionId}`;
    const es = new EventSource(url);
    es.addEventListener("append", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (Array.isArray(data.events)) {
          setEvents((prev) => [...prev, ...data.events]);
        }
      } catch {}
    });
    es.addEventListener("reset", () => {
      // reload from scratch
      fetch(`/api/session/${activeProjectId}/${activeSessionId}`)
        .then((r) => r.json())
        .then((j) => setEvents(j.events || []));
    });
    es.onerror = () => {
      // browser will auto-reconnect; ignore
    };
    return () => es.close();
  }, [activeProjectId, activeSessionId]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && detail) {
        setDetail(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId],
  );
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const onSearchHit = useCallback(
    async (hit: { projectId: string; sessionId: string; eventUuid?: string }) => {
      if (hit.projectId !== activeProjectId) {
        setActiveProjectId(hit.projectId);
        // wait for sessions to load before selecting
        const r = await fetch(`/api/sessions/${hit.projectId}`);
        const j = await r.json();
        setSessions(j.sessions || []);
      }
      setActiveSessionId(hit.sessionId);
      setSearchOpen(false);
      // scroll into view of event after load
      if (hit.eventUuid) {
        setTimeout(() => {
          const el = document.querySelector(
            `[data-event-uuid="${hit.eventUuid}"]`,
          );
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-brand", "rounded-md");
            setTimeout(() => {
              el.classList.remove("ring-2", "ring-brand", "rounded-md");
            }, 2000);
          }
        }, 400);
      }
    },
    [activeProjectId],
  );

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        onOpenSearch={() => setSearchOpen(true)}
        onReload={reloadProjects}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* left sidebar: projects (top) + sessions (bottom) */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
          <div className="border-b border-border max-h-[40%] overflow-y-auto scrollbar-thin">
            <ProjectTree
              projects={projects}
              activeId={activeProjectId}
              onSelect={(id) => {
                setActiveProjectId(id);
                setActiveSessionId(null);
              }}
            />
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <SessionList
              project={activeProject}
              sessions={sessions}
              activeId={activeSessionId}
              loading={loadingSessions}
              onSelect={setActiveSessionId}
            />
          </div>
        </aside>

        {/* main: conversation */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ConversationView
            project={activeProject}
            session={activeSession}
            events={events}
            subagents={subagents}
            loading={loadingSession}
            onShowDetail={setDetail}
          />
        </main>

        {/* right: detail pane */}
        <DetailPane
          detail={detail}
          onClose={() => setDetail(null)}
          onShowDetail={setDetail}
        />
      </div>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onHit={onSearchHit}
        projects={projects}
      />
    </div>
  );
}

export const _cnRef = cn; // keep import
