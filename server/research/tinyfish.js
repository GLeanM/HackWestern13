// TinyFish Fetch client (server-only). Fetches up to 10 URLs per request,
// runs batches in parallel, and retries each failed URL once.
// Docs: https://docs.tinyfish.ai/tinyfetch/reference

const ENDPOINT = "https://api.fetch.tinyfish.ai";
const BATCH = 10;
const RETRYABLE_URL_ERRORS = new Set(["timeout", "target_unreachable", "proxy_error", "target_http_error"]);

export class TinyFishError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function fetchBatch(urls, { apiKey, purpose, fetchImpl, timeoutMs }) {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      urls,
      format: "markdown",
      links: true,
      image_links: true,
      purpose,
      per_url_timeout_ms: 60_000,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new TinyFishError(`TinyFish fetch failed: ${code}`, code);
  }
  return json;
}

/**
 * @param {string[]} urls
 * @returns {Promise<Map<string, {ok: true, text: string, links: string[], images: string[]} | {ok: false, error: string}>>}
 */
export async function fetchPages(urls, {
  apiKey,
  purpose = "Read grocery search results (product names, sizes, prices) to price a shopping list",
  fetchImpl = fetch,
  timeoutMs = 115_000,
} = {}) {
  if (!apiKey) throw new TinyFishError("TINYFISH_API_KEY is not set", "MISSING_API_KEY");
  const unique = [...new Set(urls)];
  const out = new Map();

  const runAll = async (list) => {
    const batches = [];
    for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
    const settled = await Promise.allSettled(
      batches.map((b) => fetchBatch(b, { apiKey, purpose, fetchImpl, timeoutMs })),
    );
    settled.forEach((s, i) => {
      if (s.status === "rejected") {
        for (const u of batches[i]) out.set(u, { ok: false, error: s.reason?.code ?? "request_failed" });
        return;
      }
      for (const r of s.value.results ?? []) {
        out.set(r.url, {
          ok: true,
          text: typeof r.text === "string" ? r.text : "",
          links: r.links ?? [],
          images: r.image_links ?? [],
        });
      }
      for (const e of s.value.errors ?? []) out.set(e.url, { ok: false, error: e.error ?? "unknown" });
      for (const u of batches[i]) if (!out.has(u)) out.set(u, { ok: false, error: "missing_result" });
    });
  };

  await runAll(unique);
  const retry = unique.filter((u) => {
    const r = out.get(u);
    return !r.ok && (RETRYABLE_URL_ERRORS.has(r.error) || r.error === "request_failed" || r.error === "missing_result" || r.error === "SERVICE_BUSY" || r.error === "TIMEOUT");
  });
  if (retry.length) await runAll(retry);
  return out;
}
