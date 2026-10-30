import { ApiError, type ApiErrorCode } from "@adhyaapak/shared";

/** Error thrown by the API client. The UI branches on `code`, never on the message text. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details: { path: string; message: string }[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** Field-level messages keyed by field name, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

/** The single place all API calls go through, so error handling stays centralised. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(navigator.onLine ? "network_error" : "offline", "Network request failed", 0);
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ApiError.safeParse(data);
    if (parsed.success) {
      const { error, requestId } = parsed.data;
      throw new ApiRequestError(error.code, error.message, res.status, error.details, requestId);
    }
    throw new ApiRequestError("internal_error", "Unexpected server response", res.status);
  }
  return data as T;
}

/** Uploads a file (and any text fields) as multipart form data. The browser sets the boundary itself. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiRequestError(navigator.onLine ? "network_error" : "offline", "Network request failed", 0);
  }
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ApiError.safeParse(data);
    if (parsed.success) throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message, res.status, parsed.data.error.details, parsed.data.requestId);
    throw new ApiRequestError("internal_error", "Unexpected server response", res.status);
  }
  return data as T;
}
