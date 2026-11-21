import { useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Returns a fetch wrapper that attaches the user's Auth0 access token. */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0();
  return useCallback(
    async (path, { method = "GET", body } = {}) => {
      const token = await getAccessTokenSilently();
      const res = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, json);
      return json;
    },
    [getAccessTokenSilently],
  );
}
