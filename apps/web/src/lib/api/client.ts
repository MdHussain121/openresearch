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

async function rawRequest<T>(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const url = resolveApiUrl();
  return fetch(`${url}${endpoint}`, {
    ...options,
    headers,
  });
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await rawRequest<T>(endpoint, options);

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
