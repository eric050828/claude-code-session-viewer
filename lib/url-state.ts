// URL <-> app state sync. Kept deliberately tiny — only the things you'd
// actually want to deep-link or get back to via the browser back button.
//
// Keys are short so the URL stays scannable:
//   p = active project id
//   s = active session id
//   q = global search query (presence => search dialog open)

export interface UrlState {
  p?: string;
  s?: string;
  /** undefined = search closed; "" = open with empty query; "foo" = open with query */
  q?: string;
  /** event uuid currently in view — replaceState-mode so it doesn't pollute history */
  e?: string;
}

export function readUrl(): UrlState {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: UrlState = {};
  const p = params.get("p");
  if (p) out.p = p;
  const s = params.get("s");
  if (s) out.s = s;
  if (params.has("q")) out.q = params.get("q") || "";
  const e = params.get("e");
  if (e) out.e = e;
  return out;
}

export function writeUrl(
  next: UrlState,
  mode: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (next.p) params.set("p", next.p);
  if (next.s) params.set("s", next.s);
  if (next.q !== undefined) params.set("q", next.q);
  if (next.e) params.set("e", next.e);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  // Don't push a duplicate entry — back button skipping is worse than
  // missing entries when nothing actually changed.
  if (url === window.location.pathname + window.location.search) return;
  if (mode === "push") {
    window.history.pushState({}, "", url);
  } else {
    window.history.replaceState({}, "", url);
  }
}
