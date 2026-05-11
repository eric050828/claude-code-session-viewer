import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Disk cache lives under ~/.cache/ccsv/. Read-only with respect to ~/.claude;
// nothing here ever writes outside the user's own cache directory.
const CACHE_ROOT =
  process.env.CCSV_CACHE_DIR ||
  path.join(os.homedir(), ".cache", "claude-code-session-viewer");

export function cachePath(name: string): string {
  return path.join(CACHE_ROOT, name);
}

function ensureDir() {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
}

export interface FileSig {
  mtimeMs: number;
  size: number;
}

export function fileSig(stat: fs.Stats): FileSig {
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

export function sigEquals(a: FileSig | undefined, b: FileSig): boolean {
  return !!a && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

interface DiskMap<V> {
  version: number;
  entries: Record<string, { sig: FileSig; value: V }>;
}

// Bump when on-disk cache shape changes or session-summarize logic changes
// in a way that invalidates previously cached entries.
const VERSION = 2;
const inMem = new Map<string, DiskMap<unknown>>();
const dirtyTimers = new Map<string, NodeJS.Timeout>();

export function loadCache<V>(name: string): DiskMap<V> {
  const cached = inMem.get(name);
  if (cached) return cached as DiskMap<V>;
  let data: DiskMap<V> = { version: VERSION, entries: {} };
  try {
    const raw = fs.readFileSync(cachePath(name), "utf-8");
    const parsed = JSON.parse(raw) as DiskMap<V>;
    if (parsed && parsed.version === VERSION && parsed.entries) {
      data = parsed;
    }
  } catch {
    // missing or corrupted — start fresh
  }
  inMem.set(name, data as DiskMap<unknown>);
  return data;
}

export function saveCache(name: string): void {
  // Debounce writes to avoid hammering disk.
  const existing = dirtyTimers.get(name);
  if (existing) clearTimeout(existing);
  dirtyTimers.set(
    name,
    setTimeout(() => {
      dirtyTimers.delete(name);
      const data = inMem.get(name);
      if (!data) return;
      try {
        ensureDir();
        const tmp = cachePath(name) + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, cachePath(name));
      } catch {
        // best-effort; swallow
      }
    }, 500),
  );
}

export function getCached<V>(
  name: string,
  key: string,
  sig: FileSig,
): V | undefined {
  const cache = loadCache<V>(name);
  const e = cache.entries[key];
  if (e && sigEquals(e.sig, sig)) return e.value;
  return undefined;
}

export function setCached<V>(
  name: string,
  key: string,
  sig: FileSig,
  value: V,
): void {
  const cache = loadCache<V>(name);
  cache.entries[key] = { sig, value };
  saveCache(name);
}

export function pruneCache(
  name: string,
  validKeys: Set<string>,
): void {
  const cache = loadCache<unknown>(name);
  let changed = false;
  for (const key of Object.keys(cache.entries)) {
    if (!validKeys.has(key)) {
      delete cache.entries[key];
      changed = true;
    }
  }
  if (changed) saveCache(name);
}

/** Bounded concurrency map — VM-friendly: never spawns more than `limit` parallel I/O. */
export async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
