import type { Run } from "@browser-prototype/contract";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).detail ?? message;
    } catch {
      // not JSON; keep the status text
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  signIn: (token: string) => call<{ signed_in: boolean }>("/v1/session", { method: "POST", body: JSON.stringify({ token }) }),
  runs: () => call<Run[]>("/v1/runs"),
  run: (id: string) => call<Run>(`/v1/runs/${id}`),
  start: (workflow: string, input: Record<string, unknown>) =>
    call<Run>("/v1/runs", { method: "POST", body: JSON.stringify({ workflow, input }) }),
  resume: (id: string, userResponse: string) =>
    call<Run>(`/v1/workflows/resume/${id}`, { method: "POST", body: JSON.stringify({ user_response: userResponse }) }),
  /** The live view link, asked for only while the browser panel is open. Callers keep it in memory only. */
  browser: (id: string) => call<{ url: string }>(`/v1/runs/${id}/browser`, { cache: "no-store" }),
};

/** Opening the address the runner printed signs this browser in. The token leaves the address bar at once. */
export async function signInFromAddress(): Promise<void> {
  const match = window.location.hash.match(/token=([^&]+)/);
  if (!match) return;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  await api.signIn(decodeURIComponent(match[1]));
}
