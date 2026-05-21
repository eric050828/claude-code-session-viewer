"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RotateCw, Terminal } from "lucide-react";
import { CopyButton } from "./copy-button";
import { formatBytes, formatRelative } from "@/lib/utils";

interface FetchResult {
  content?: string;
  size?: number;
  mtime?: string;
  truncated?: boolean;
  error?: string;
  exists?: boolean;
}

/**
 * Reads /tmp/claude-XXX/.../tasks/<id>.output from the local filesystem and
 * shows it expanded under the originating Bash or Task tool card — so a
 * background-mode invocation is no longer "the result is hidden in a file".
 *
 * Background tmp files don't survive reboot; the API returns 404 in that case
 * and we render a small "file gone" hint instead of a misleading empty box.
 */
export function BackgroundOutput({
  taskId,
  path,
}: {
  taskId: string;
  path: string;
}) {
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/task-output?path=${encodeURIComponent(path)}`);
      const j = (await r.json()) as FetchResult;
      setData(j);
    } catch (e) {
      setData({ error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mt-3 overflow-hidden rounded border border-border/40 bg-background">
      {/* Header: toggle button sits next to action buttons (reload, copy),
         not wrapping them — nesting interactive elements inside a <button>
         is invalid HTML. */}
      <div className="flex items-center gap-1 border-b border-border/40 bg-muted/20 pr-2 text-[10px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 focus-visible:bg-muted/30"
        >
          <Terminal aria-hidden="true" className="h-3 w-3" />
          <span className="font-mono">background output</span>
          <span className="font-mono opacity-70" translate="no">
            {taskId}
          </span>
          {data?.size != null && (
            <span className="tabular-nums opacity-60">{formatBytes(data.size)}</span>
          )}
          {data?.truncated && (
            <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
              truncated
            </span>
          )}
          {data?.mtime && (
            <span className="opacity-60">·&nbsp;{formatRelative(data.mtime)}</span>
          )}
          {data?.exists === false && (
            <span className="text-muted-foreground/70">·&nbsp;file gone</span>
          )}
        </button>
        {loading && (
          <Loader2
            aria-hidden="true"
            className="h-3 w-3 shrink-0 motion-safe:animate-spin"
          />
        )}
        <button
          type="button"
          onClick={load}
          title="Reload"
          aria-label="Reload background output"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
        >
          <RotateCw aria-hidden="true" className="h-3 w-3" />
        </button>
        {data?.content && (
          <CopyButton text={data.content} className="opacity-70" />
        )}
      </div>
      {open && (
        <div className="max-h-[500px] overflow-auto overscroll-contain">
          {loading && !data && (
            <div
              aria-live="polite"
              className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
              Loading…
            </div>
          )}
          {data?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 text-xs text-muted-foreground"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-amber-700 dark:text-amber-300" />
              <div>
                <div>{data.error}</div>
                <div className="mt-1 font-mono text-[10px] opacity-60" translate="no">
                  {path}
                </div>
              </div>
            </div>
          )}
          {data?.content && (
            <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-emerald-800 dark:text-emerald-200/90">
              {data.content || "(empty)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
