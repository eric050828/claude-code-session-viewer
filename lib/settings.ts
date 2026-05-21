"use client";

import { useSyncExternalStore } from "react";
import {
  SHORTCUT_DEFAULTS,
  type ShortcutAction,
} from "./keyboard";

// User-tunable preferences. Persisted to localStorage as a single JSON
// blob; subscribed via useSettings() across the app.

export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  theme: ThemeMode;
  /** action → combo string. Missing keys fall back to SHORTCUT_DEFAULTS. */
  shortcuts: Partial<Record<ShortcutAction, string>>;
  showMinimap: boolean;
  expandThinking: boolean;
  liveUpdates: boolean;
  /** When opening a session and the URL has no event anchor, jump to the
   *  end of the conversation. Off = stay at top. */
  autoScrollBottom: boolean;
  /** Hide the project+session sidebar to give the conversation more room. */
  sidebarCollapsed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  shortcuts: {},
  showMinimap: true,
  expandThinking: false,
  liveUpdates: true,
  autoScrollBottom: true,
  sidebarCollapsed: false,
};

/** Resolve the active combo for an action (user override or default). */
export function getShortcut(
  settings: Settings,
  action: ShortcutAction,
): string {
  return settings.shortcuts[action] || SHORTCUT_DEFAULTS[action];
}

const STORAGE_KEY = "ccsv:settings";
const LEGACY_THEME_KEY = "ccsv:theme";

function isValidShortcuts(v: unknown): v is Settings["shortcuts"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => typeof x === "string",
  );
}

function validateSettings(parsed: unknown): Settings {
  if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS;
  const p = parsed as Record<string, unknown>;
  const next: Settings = { ...DEFAULT_SETTINGS };
  if (p.theme === "light" || p.theme === "dark" || p.theme === "system") {
    next.theme = p.theme;
  }
  if (isValidShortcuts(p.shortcuts)) next.shortcuts = p.shortcuts;
  for (const key of [
    "showMinimap",
    "expandThinking",
    "liveUpdates",
    "autoScrollBottom",
    "sidebarCollapsed",
  ] as const) {
    if (typeof p[key] === "boolean") next[key] = p[key] as boolean;
  }
  return next;
}

function readStorage(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return validateSettings(JSON.parse(raw));
    // First-load migration: pre-existing ccsv:theme moves into the blob.
    const legacy = window.localStorage.getItem(LEGACY_THEME_KEY) as
      | ThemeMode
      | null;
    if (legacy === "light" || legacy === "dark" || legacy === "system") {
      const migrated: Settings = { ...DEFAULT_SETTINGS, theme: legacy };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

let memo: Settings | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Settings {
  if (memo) return memo;
  memo = readStorage();
  return memo;
}

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // also reflect cross-tab changes via the storage event
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      memo = readStorage();
      fn();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getSettings(): Settings {
  return getSnapshot();
}

export function updateSettings(patch: Partial<Settings>): void {
  if (typeof window === "undefined") return;
  const next = { ...getSnapshot(), ...patch };
  memo = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    // mirror theme to the legacy key so the FOUC-safe init script keeps
    // working unchanged (it reads ccsv:theme on first paint)
    window.localStorage.setItem(LEGACY_THEME_KEY, next.theme);
  } catch {}
  emit();
}

export function resetSettings(): void {
  updateSettings(DEFAULT_SETTINGS);
}

/** React hook — subscribe to settings and re-render when they change. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SETTINGS);
}

/**
 * Inline script that runs in <head> before React hydrates so the initial
 * paint matches the persisted theme — avoids the flash-of-wrong-theme.
 * Reads the legacy `ccsv:theme` key (mirrored on every settings update).
 */
export const themeInitScript = `(function(){try{var m=localStorage.getItem('${LEGACY_THEME_KEY}')||'system';var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;dark?c.add('dark'):c.remove('dark');document.documentElement.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;

/** Apply the theme value to <html> (toggle .dark class + color-scheme). */
export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof window === "undefined") return;
  const wantDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", wantDark);
  document.documentElement.style.colorScheme = wantDark ? "dark" : "light";
}
