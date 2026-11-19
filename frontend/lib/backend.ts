// Server-side helper: forward a request to the Python face API.

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:8001";

const PASS_HEADERS = ["content-type", "content-disposition", "x-cmeme-info"];

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** FastAPI reports errors as {detail: string | [{msg}]} — flatten to one line. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const detail = JSON.parse(text).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => d.msg ?? JSON.stringify(d)).join("; ");
    }
  } catch { /* not JSON */ }
  return text || `Backend error ${res.status}`;
}

/** Stream the request through to the backend and the response back. */
export async function proxy(req: Request, path: string): Promise<Response> {
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: req.method,
      headers,
      body: req.body,
    });
  } catch {
    return json({ error: "Could not reach the face-swap backend. Is it running?" }, 503);
  }

  if (!res.ok) return json({ error: await errorMessage(res) }, res.status);

  const out = new Headers();
  for (const name of PASS_HEADERS) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

/** Fetch JSON from a public API, cached in memory for `ttlMs`. */
const cache = new Map<string, { at: number; body: string }>();

export async function cachedJson(
  url: string,
  ttlMs: number,
  pick: (data: unknown) => unknown = (d) => d,
): Promise<Response> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) {
    return new Response(hit.body, { headers: { "Content-Type": "application/json" } });
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const body = JSON.stringify(pick(await res.json()));
    cache.set(url, { at: Date.now(), body });
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  } catch {
    // Serve stale data rather than an empty grid when upstream hiccups.
    if (hit) return new Response(hit.body, { headers: { "Content-Type": "application/json" } });
    return json({ error: "Could not load memes right now." }, 502);
  }
}
