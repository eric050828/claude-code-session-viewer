"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";
const STORAGE_KEY = "ccsv:theme";

function applyTheme(mode: Mode) {
  const wantDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", wantDark);
  document.documentElement.style.colorScheme = wantDark ? "dark" : "light";
}

/**
 * Inline script that runs before React hydrates so the initial paint matches
 * the persisted preference (no flash of wrong theme).
 */
export const themeInitScript = `(function(){try{var m=localStorage.getItem('${STORAGE_KEY}')||'system';var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;dark?c.add('dark'):c.remove('dark');document.documentElement.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Mode | null) || "system";
    setMode(stored);
    setMounted(true);

    // Respond to OS-level changes while in "system" mode.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = (localStorage.getItem(STORAGE_KEY) as Mode | null) || "system";
      if (current === "system") applyTheme("system");
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const set = (m: Mode) => {
    localStorage.setItem(STORAGE_KEY, m);
    setMode(m);
    applyTheme(m);
  };

  const options: { value: Mode; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div
      className="flex h-8 items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
      role="group"
      aria-label="Theme"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => set(value)}
          title={label}
          aria-label={`${label} theme`}
          aria-pressed={mounted && mode === value}
          className={cn(
            "flex h-6 w-7 items-center justify-center rounded transition-colors",
            mounted && mode === value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden="true" className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}
