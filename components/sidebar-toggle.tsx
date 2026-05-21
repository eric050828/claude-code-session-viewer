"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { formatCombo } from "@/lib/keyboard";
import { getShortcut, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/**
 * Sidebar collapse/expand button. Two placements:
 *   - inside the sidebar header (visible when expanded)
 *   - in the conversation header's left edge (visible when collapsed)
 * Both render the same button, just with the icon flipped.
 */
export function SidebarToggleButton({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const settings = useSettings();
  const combo = formatCombo(getShortcut(settings, "sidebar.toggle"));
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${label} (${combo})`}
      aria-label={label}
      aria-keyshortcuts="Meta+B Control+B"
      aria-pressed={!collapsed}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}
