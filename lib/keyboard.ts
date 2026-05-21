// Keyboard shortcut definitions, parser, and matcher.
//
// Combo grammar:
//   combo := (modifier "+")* key
//   modifier := "Mod" | "Alt" | "Shift"   // "Mod" = Cmd on macOS, Ctrl elsewhere
//   key := a single character ("j", ",") or named key ("Escape", "Enter", "ArrowUp")
//
// Examples: "Mod+K", "Mod+,", "Shift+J", "j", "Escape"
//
// Match semantics: required modifiers must be pressed AND no other
// modifier may be pressed. Bare-key combos (no modifiers) intentionally
// fire only when no modifier is held.

export type ShortcutAction =
  | "search.open"
  | "settings.open"
  | "find.open"
  | "nav.prev"
  | "nav.next"
  | "sidebar.toggle";

export const SHORTCUT_DEFAULTS: Record<ShortcutAction, string> = {
  "search.open": "Mod+K",
  "settings.open": "Mod+,",
  "find.open": "Mod+F",
  "nav.prev": "j",
  "nav.next": "k",
  "sidebar.toggle": "Mod+b",
};

export const SHORTCUT_META: Record<
  ShortcutAction,
  { name: string; hint: string; gateInInputs: boolean }
> = {
  "search.open": {
    name: "Open global search",
    hint: "Across all projects and sessions",
    gateInInputs: false,
  },
  "settings.open": {
    name: "Open settings",
    hint: "This dialog",
    gateInInputs: false,
  },
  "find.open": {
    name: "Find in session",
    hint: "Bar over the conversation",
    gateInInputs: false,
  },
  "nav.prev": {
    name: "Previous user message",
    hint: "Scroll to the user message above",
    gateInInputs: true,
  },
  "nav.next": {
    name: "Next user message",
    hint: "Scroll to the user message below",
    gateInInputs: true,
  },
  "sidebar.toggle": {
    name: "Toggle sidebar",
    hint: "Hide or show the project + session list",
    gateInInputs: false,
  },
};

export const ALL_ACTIONS: ShortcutAction[] = [
  "search.open",
  "settings.open",
  "find.open",
  "nav.prev",
  "nav.next",
  "sidebar.toggle",
];

interface ParsedCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { mod: false, alt: false, shift: false, key: "" };
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return {
    mod: mods.has("mod") || mods.has("cmd") || mods.has("meta") || mods.has("ctrl"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
    key: key.length === 1 ? key.toLowerCase() : key,
  };
}

export function matchShortcut(combo: string, e: KeyboardEvent): boolean {
  if (!combo) return false;
  const c = parseCombo(combo);
  if (!c.key) return false;
  const pressedMod = e.metaKey || e.ctrlKey;
  if (c.mod !== pressedMod) return false;
  if (c.alt !== e.altKey) return false;
  if (c.shift !== e.shiftKey) return false;
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // c.key was already normalized by parseCombo (single chars lowercased,
  // named keys kept as-is). Compare directly — lowercasing again here
  // would break named keys like "ArrowDown" vs the canonical form.
  return eventKey === c.key;
}

/** Pretty display for a combo, platform-aware. */
export function formatCombo(combo: string): string {
  const c = parseCombo(combo);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts: string[] = [];
  if (c.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (c.alt) parts.push(isMac ? "⌥" : "Alt");
  if (c.shift) parts.push(isMac ? "⇧" : "Shift");
  const key =
    c.key.length === 1
      ? c.key.toUpperCase()
      : c.key.replace(/^Arrow/, "").replace(/^([a-z])/, (m) => m.toUpperCase());
  parts.push(key);
  return isMac ? parts.join("") : parts.join("+");
}

/** Capture a combo from a KeyDown event. Returns null for modifier-only presses. */
export function captureCombo(e: KeyboardEvent): string | null {
  const ignored = new Set([
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "OS",
    "ContextMenu",
    "CapsLock",
    "Tab",
  ]);
  if (ignored.has(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(key);
  return parts.join("+");
}

/** True if the event's focus target is an editable element. */
export function isInEditable(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return true;
  if (t.isContentEditable) return true;
  return false;
}
