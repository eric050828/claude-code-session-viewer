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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5 text-left text-[10px] text-muted-foreground hover:bg-muted/30"
      >
        <Terminal aria-hidden="true" className="h-3 w-3" />
        <span className="font-mono">background output</span>
        <span className="font-mono opacity-70" translate="no">
          {taskId}
        </span>
        {data?.size != null && (
          <span className="opacity-60">{formatBytes(data.size)}</span>
        )}
        {data?.truncated && (
          <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
            truncated
          </span>
        )}
        {data?.mtime && (
          <span className="opacity-60">· {formatRelative(data.mtime)}</span>
        )}
        {data?.exists === false && (
          <span className="text-muted-foreground/70">· file gone</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {loading && <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              load();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                load();
              }
            }}
            className="cursor-pointer rounded p-1 hover:bg-muted hover:text-foreground"
            title="Reload"
            aria-label="Reload background output"
          >
            <RotateCw aria-hidden="true" className="h-3 w-3" />
          </span>
          {data?.content && (
            <CopyButton text={data.content} className="opacity-70" />
          )}
        </span>
      </button>
      {open && (
        <div className="max-h-[500px] overflow-auto">
          {loading && !data && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
              Loading…
            </div>
          )}
          {data?.error && (
            <div className="flex items-start gap-2 p-3 text-xs text-muted-foreground">
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
