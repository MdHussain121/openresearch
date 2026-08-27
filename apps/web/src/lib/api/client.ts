export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

let _runtimeApiUrl: string | null = null;

export function resolveApiUrl(): string {
  if (_runtimeApiUrl !== null) return _runtimeApiUrl;
  _runtimeApiUrl = API_BASE_URL;
  return _runtimeApiUrl;
}

export async function initApiUrl(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = (await res.json()) as { apiUrl?: string };
      if (config.apiUrl) {
        _runtimeApiUrl = config.apiUrl;
      }
    }
  } catch {
    // Config endpoint unavailable; keep the build-time value.
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ApiError';
    this.status = status;
  }
}

function describeErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        const msg = (item as { msg?: unknown }).msg;
        if (typeof msg === 'string') return msg;
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    const obj = detail as Record<string, unknown>;
    for (const key of ['msg', 'message', 'error']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return '';
}

export async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const errJson: unknown = await response.json();
    if (errJson && typeof errJson === 'object' && 'detail' in errJson) {
      const detail = describeErrorDetail((errJson as { detail: unknown }).detail);
      if (detail) return detail;
    }
    const topLevel = describeErrorDetail(errJson);
    if (topLevel) return topLevel;
  } catch {
    // Response body was not JSON; use the fallback below.
  }
  return `${fallback} (HTTP ${response.status})`;
}

function validateResponse(data: unknown): unknown {
  if (data === null || data === undefined) {
    throw new ApiError('API returned empty response body', 200);
  }
  return data;
}

const TOKEN_KEY = 'openresearch_tokens';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string; refresh_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { refresh_token?: string };
    return parsed.refresh_token ?? null;
  } catch {
    return null;
  }
}

function setAccessToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.access_token = token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

/**
 * Attempt a silent token refresh via /auth/refresh.  Returns the new access
 * token on success, or null on failure (caller should redirect to login).
 */
let _refreshInFlight: Promise<string | null> | null = null;
async function tryRefreshAccessToken(): Promise<string | null> {
  // Deduplicate concurrent refresh attempts
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      const url = resolveApiUrl();
      const res = await fetch(`${url}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string; refresh_token?: string };
      setAccessToken(data.access_token);
      // Also persist the new refresh token if the server rotated it
      if (data.refresh_token) {
        try {
          const raw = localStorage.getItem(TOKEN_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          parsed.refresh_token = data.refresh_token;
          localStorage.setItem(TOKEN_KEY, JSON.stringify(parsed));
        } catch { /* ignore */ }
      }
      return data.access_token;
    } catch {
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

async function rawRequest<T>(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = resolveApiUrl();
  return fetch(`${url}${endpoint}`, {
    ...options,
    headers,
  });
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let response = await rawRequest<T>(endpoint, options);

  // On 401, attempt a silent token refresh and retry once
  if (response.status === 401 && !endpoint.includes('/auth/')) {
    const newToken = await tryRefreshAccessToken();
    if (newToken) {
      response = await rawRequest<T>(endpoint, options);
    }
  }

  if (!response.ok) {
    throw new ApiError(await extractErrorMessage(response, 'API request failed'), response.status);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const data: unknown = await response.json();
  return validateResponse(data) as T;
}

/**
 * POSTs to an SSE endpoint and invokes `onFrame` for every `data:` payload.
 * Frames are delimited by blank lines per the text/event-stream spec.
 */
export async function streamRequest(
  endpoint: string,
  body: unknown,
  onFrame: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = resolveApiUrl();
  const response = await fetch(`${url}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new ApiError(
      await extractErrorMessage(response, 'Streaming request failed'),
      response.status
    );
  }

  if (!response.body) {
    throw new Error('Streaming responses are not supported in this environment');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitEvents = (rawBlock: string) => {
    for (const line of rawBlock.split('\n')) {
      if (line.startsWith('data:')) {
        onFrame(line.slice(5).trimStart());
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        emitEvents(rawEvent);
      }
    }

    if (buffer.trim().length > 0) {
      emitEvents(buffer);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
