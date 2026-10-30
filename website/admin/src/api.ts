export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface SessionState {
  state: "setup" | "signed-out" | "signed-in";
  setupReady?: boolean;
  email?: string;
  csrf?: string;
}

let csrfToken = "";

/** GET without a body, POST with one. Writes carry the session's CSRF token. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const write = body !== undefined;
  const res = await fetch(`/admin/api/${path}`, {
    method: write ? "POST" : "GET",
    credentials: "same-origin",
    headers: write ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken } : {},
    body: write ? JSON.stringify(body) : null,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && path !== "login") window.dispatchEvent(new Event("admin:signed-out"));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Le serveur ne répond pas correctement.");
  return data as T;
}

export async function loadSession(): Promise<SessionState> {
  const session = await api<SessionState>("session");
  csrfToken = session.csrf ?? "";
  return session;
}
