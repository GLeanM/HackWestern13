import { useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

const NEEDS_INTERACTION = new Set(["consent_required", "login_required", "interaction_required"]);

/**
 * Returns a fetch wrapper that attaches the user's Auth0 access token.
 * Pass `scope` to ask for an extra permission just for this call (step-up):
 * Auth0 shows a consent popup the first time if needed.
 */
export function useApi() {
  const { getAccessTokenSilently, getAccessTokenWithPopup } = useAuth0();
  return useCallback(
    async (path, { method = "GET", body, scope } = {}) => {
      let token;
      if (scope) {
        const authorizationParams = { scope: `openid profile email read:profile write:profile ${scope}` };
        try {
          token = await getAccessTokenSilently({ authorizationParams, cacheMode: "off" });
        } catch (err) {
          if (!NEEDS_INTERACTION.has(err.error)) throw err;
          token = await getAccessTokenWithPopup({ authorizationParams });
        }
      } else {
        token = await getAccessTokenSilently();
      }
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
    [getAccessTokenSilently, getAccessTokenWithPopup],
  );
}
