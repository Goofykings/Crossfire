/**
 * Resolve a path inside /public against Vite's base URL so assets work both in dev ("/") and on a
 * GitHub Pages project site ("./" or "/<repo>/").
 */
const BASE = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return BASE.endsWith('/') ? BASE + clean : `${BASE}/${clean}`;
}

/** Split an asset URL into Babylon's (rootUrl, fileName) pair. */
export function splitUrl(url: string): { root: string; file: string } {
  const i = url.lastIndexOf('/');
  return { root: url.slice(0, i + 1), file: url.slice(i + 1) };
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
