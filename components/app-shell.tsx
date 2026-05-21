"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectTree } from "./project-tree";
import { SessionList } from "./session-list";
import { ConversationView } from "./conversation-view";
import { DetailPane } from "./detail-pane";
import { TopBar } from "./top-bar";
import { SearchDialog } from "./search-dialog";
import { SettingsDialog } from "./settings-dialog";
import type {
  ProjectMeta,
  SessionMeta,
  SessionEvent,
  SubagentMeta,
} from "@/lib/types";
import { cn, cssEscape } from "@/lib/utils";
import { readUrl, writeUrl } from "@/lib/url-state";
import { getShortcut, updateSettings, useSettings } from "@/lib/settings";
import { matchShortcut } from "@/lib/keyboard";

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

  // Initial state comes from the URL when present (so deep-links and
  // reload-after-back-button restore the right view). Falls back to the
  // first project as before.
  const initialUrl = useMemo(() => readUrl(), []);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    initialUrl.p ?? initialProjects[0]?.id ?? null,
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialUrl.s ?? null,
  );
  const [searchOpen, setSearchOpen] = useState(initialUrl.q !== undefined);
  const [searchQuery, setSearchQuery] = useState(initialUrl.q ?? "");
  const [activeEventId, setActiveEventId] = useState<string | null>(
    initialUrl.e ?? null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useSettings();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [subagents, setSubagents] = useState<SubagentMeta[]>([]);
  const [detail, setDetail] = useState<DetailContent | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  // Set true while we're applying state from a popstate event, so the
  // sync effects below don't loop the URL back to themselves.
  const popInFlight = useRef(false);
  const eventUrlTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // SSE live updates for active session — gated by user setting.
  useEffect(() => {
    if (!settings.liveUpdates) return;
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
      fetch(`/api/session/${activeProjectId}/${activeSessionId}`)
        .then((r) => r.json())
        .then((j) => setEvents(j.events || []));
    });
    es.onerror = () => {
      /* browser auto-reconnects */
    };
    return () => es.close();
  }, [activeProjectId, activeSessionId, settings.liveUpdates]);

  const toggleSidebar = useCallback(() => {
    updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
  }, [settings.sidebarCollapsed]);

  // global keyboard shortcuts — bindings come from settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(getShortcut(settings, "search.open"), e)) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (matchShortcut(getShortcut(settings, "settings.open"), e)) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (matchShortcut(getShortcut(settings, "sidebar.toggle"), e)) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (e.key === "Escape" && detail) {
        setDetail(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, settings.shortcuts, toggleSidebar]);

  // Browser back/forward — re-read URL and apply.
  useEffect(() => {
    const onPop = () => {
      popInFlight.current = true;
      const u = readUrl();
      setActiveProjectId(u.p ?? null);
      setActiveSessionId(u.s ?? null);
      setSearchOpen(u.q !== undefined);
      setSearchQuery(u.q ?? "");
      setActiveEventId(u.e ?? null);
      setTimeout(() => {
        popInFlight.current = false;
      }, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keep URL in sync with nav state (project + session). Push entries so
  // back button steps through these.
  useEffect(() => {
    if (popInFlight.current) return;
    writeUrl(
      {
        p: activeProjectId || undefined,
        s: activeSessionId || undefined,
        q: searchOpen ? searchQuery : undefined,
        e: activeEventId || undefined,
      },
      "push",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeSessionId, searchOpen]);

  // Search-query typing replaces (don't pollute history per keystroke).
  useEffect(() => {
    if (popInFlight.current) return;
    if (!searchOpen) return;
    writeUrl(
      {
        p: activeProjectId || undefined,
        s: activeSessionId || undefined,
        q: searchQuery,
        e: activeEventId || undefined,
      },
      "replace",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Active event sync. Two modes:
  //   replace — passive scroll tracking (debounced, doesn't pollute history)
  //   push    — explicit nav (j/k, minimap click); creates a back-step so
  //             the back button returns to the message you came from
  const onActiveEventChange = useCallback(
    (uuid: string | null, mode: "replace" | "push" = "replace") => {
      if (popInFlight.current) return;
      setActiveEventId(uuid);
      if (eventUrlTimerRef.current) clearTimeout(eventUrlTimerRef.current);
      const next = {
        p: activeProjectId || undefined,
        s: activeSessionId || undefined,
        q: searchOpen ? searchQuery : undefined,
        e: uuid || undefined,
      };
      if (mode === "push") {
        // Cancel any pending replace so it can't overwrite our push.
        writeUrl(next, "push");
      } else {
        eventUrlTimerRef.current = setTimeout(() => {
          writeUrl(next, "replace");
        }, 250);
      }
    },
    [activeProjectId, activeSessionId, searchOpen, searchQuery],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);
  const onSearchOpenChange = useCallback(
    (v: boolean) => {
      if (v) openSearch();
      else closeSearch();
    },
    [openSearch, closeSearch],
  );

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
        const r = await fetch(`/api/sessions/${hit.projectId}`);
        const j = await r.json();
        setSessions(j.sessions || []);
      }
      setActiveSessionId(hit.sessionId);
      closeSearch();
      if (hit.eventUuid) {
        const eventUuid = hit.eventUuid;
        setTimeout(() => {
          const el = document.querySelector(
            `[data-event-uuid="${cssEscape(eventUuid)}"]`,
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
    [activeProjectId, closeSearch],
  );

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        onOpenSearch={openSearch}
        onOpenSettings={() => setSettingsOpen(true)}
        onReload={reloadProjects}
        onToggleSidebar={toggleSidebar}
        sidebarCollapsed={settings.sidebarCollapsed}
      />
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200 motion-reduce:transition-none",
            settings.sidebarCollapsed ? "w-0 border-r-0" : "w-72",
          )}
          aria-hidden={settings.sidebarCollapsed}
        >
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

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ConversationView
            project={activeProject}
            session={activeSession}
            events={events}
            subagents={subagents}
            loading={loadingSession}
            onShowDetail={setDetail}
            activeEventId={activeEventId}
            onActiveEventChange={onActiveEventChange}
          />
        </main>

        <DetailPane
          detail={detail}
          onClose={() => setDetail(null)}
          onShowDetail={setDetail}
        />
      </div>

      <SearchDialog
        open={searchOpen}
        onOpenChange={onSearchOpenChange}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onHit={onSearchHit}
        projects={projects}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export const _cnRef = cn; // keep import
