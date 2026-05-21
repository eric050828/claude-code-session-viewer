"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  type JKDirection,
  type Settings,
  type ThemeMode,
  applyThemeToDocument,
  resetSettings,
  updateSettings,
  useSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const settings = useSettings();

  const setTheme = (theme: ThemeMode) => {
    updateSettings({ theme });
    applyThemeToDocument(theme);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 motion-safe:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[10%] z-50 w-[480px] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl motion-safe:animate-fade-in">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">
              Settings
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close settings"
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Configure theme, navigation keys, and display options. All
            settings persist to local storage.
          </Dialog.Description>

          <div className="max-h-[70vh] overflow-y-auto px-4 py-3 scrollbar-thin">
            <Section title="Theme">
              <Segmented
                value={settings.theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: "Light", Icon: Sun },
                  { value: "dark", label: "Dark", Icon: Moon },
                  { value: "system", label: "System", Icon: Monitor },
                ]}
              />
            </Section>

            <Section title="Navigation">
              <Row
                label="j / k direction"
                hint="Which way these keys jump through user messages."
              >
                <Segmented<JKDirection>
                  value={settings.jkDirection}
                  onChange={(jkDirection) => updateSettings({ jkDirection })}
                  options={[
                    { value: "j-up", label: "j ↑ / k ↓" },
                    { value: "j-down", label: "j ↓ / k ↑" },
                  ]}
                />
              </Row>
            </Section>

            <Section title="Display">
              <Toggle
                label="Show minimap"
                hint="Right-edge dot track for user messages."
                checked={settings.showMinimap}
                onChange={(showMinimap) => updateSettings({ showMinimap })}
              />
              <Toggle
                label="Auto-expand thinking blocks"
                hint="Show Claude's reasoning expanded by default."
                checked={settings.expandThinking}
                onChange={(expandThinking) =>
                  updateSettings({ expandThinking })
                }
              />
              <Toggle
                label="Live updates"
                hint="Stream new messages from in-flight sessions via SSE."
                checked={settings.liveUpdates}
                onChange={(liveUpdates) => updateSettings({ liveUpdates })}
              />
              <Toggle
                label="Auto-scroll to bottom on open"
                hint="When no URL anchor is present. Otherwise the view restores the URL position."
                checked={settings.autoScrollBottom}
                onChange={(autoScrollBottom) =>
                  updateSettings({ autoScrollBottom })
                }
              />
            </Section>
          </div>

          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
            <span>
              Stored in <code className="font-mono">localStorage</code>
            </span>
            <button
              type="button"
              onClick={() => {
                resetSettings();
                applyThemeToDocument(DEFAULT_SETTINGS.theme);
              }}
              className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted hover:text-foreground"
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
              Reset to defaults
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked
            ? "border-brand/60 bg-brand"
            : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </Row>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{
    value: T;
    label: string;
    Icon?: React.ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
      role="group"
    >
      {options.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
            value === v
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {Icon && <Icon aria-hidden="true" className="h-3 w-3" />}
          {label}
        </button>
      ))}
    </div>
  );
}
