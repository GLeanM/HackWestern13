// TinyFish Web Agent client (server-only): start an async browser run and
// poll it. Docs: https://docs.tinyfish.ai/api-reference/automation/start-automation-asynchronously

const API = "https://agent.tinyfish.ai/v1";

export class AgentError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call(path, { apiKey, method = "GET", body, fetchImpl, timeoutMs = 30_000 }) {
  if (!apiKey) throw new AgentError("TINYFISH_API_KEY is not set", "MISSING_API_KEY");
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { "X-API-Key": apiKey, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new AgentError(json?.error?.message ?? `TinyFish request failed (${code})`, code, res.status);
  }
  return json;
}

export function createAgentClient({ apiKey, fetchImpl = fetch }) {
  return {
    /** @returns {Promise<string>} run id */
    async startRun({ url, goal, outputSchema, profileId, maxSteps, maxDurationSeconds }) {
      const json = await call("/automation/run-async", {
        apiKey,
        fetchImpl,
        method: "POST",
        body: {
          url,
          goal,
          output_schema: outputSchema,
          use_profile: true,
          profile_id: profileId,
          proxy_config: { enabled: true, country_code: "CA" },
          // Custom max_steps needs a TinyFish beta flag, so it's only sent when set.
          agent_config: { ...(maxSteps && { max_steps: maxSteps }), max_duration_seconds: maxDurationSeconds },
          api_integration: "cartpilot",
        },
      });
      if (!json?.run_id) {
        throw new AgentError(json?.error?.message ?? "TinyFish didn't start the run", json?.error?.code ?? "NO_RUN_ID");
      }
      return json.run_id;
    },

    /** @returns {Promise<{status, result, error, streamingUrl, steps}>} */
    async getRun(id) {
      const r = await call(`/runs/${encodeURIComponent(id)}?screenshots=none&html=none`, { apiKey, fetchImpl });
      return {
        status: r.status,
        result: r.result ?? null,
        error: r.error ?? null,
        streamingUrl: r.streaming_url ?? null,
        steps: r.num_of_steps ?? null,
      };
    },
  };
}
