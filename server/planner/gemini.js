// Minimal Gemini REST client with structured JSON output, retries, and model fallback.
// Server-only: the API key never reaches the browser.

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class GeminiError extends Error {}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string[]} o.models        tried in order; each gets `attemptsPerModel` tries on retryable errors
 * @param {string} o.system          system instruction
 * @param {string} o.prompt          user content
 * @param {object} o.schema          JSON Schema for the response
 * @param {string} [o.thinkingLevel] "low" | "medium" | "high"
 * @returns {Promise<{ data: any, model: string }>}
 */
export async function generateJson({
  apiKey,
  models,
  system,
  prompt,
  schema,
  thinkingLevel = "low",
  attemptsPerModel = 2,
  timeoutMs = 90_000,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0.7,
      ...(thinkingLevel && { thinkingConfig: { thinkingLevel } }),
    },
  });

  let lastError;
  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${API}/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = new GeminiError(`${model}: ${err.name === "TimeoutError" ? "timed out" : "network error"}`);
        continue;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        lastError = new GeminiError(`${model}: HTTP ${res.status} ${json?.error?.status ?? ""}`.trim());
        if (RETRYABLE.has(res.status)) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        break; // non-retryable (e.g. 404 retired model) → next model
      }
      const text = json?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      try {
        return { data: JSON.parse(text), model };
      } catch {
        lastError = new GeminiError(`${model}: response was not valid JSON (finish: ${json?.candidates?.[0]?.finishReason ?? "unknown"})`);
      }
    }
  }
  throw lastError ?? new GeminiError("no models configured");
}
