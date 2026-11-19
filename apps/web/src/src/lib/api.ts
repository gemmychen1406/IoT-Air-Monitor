export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await apiPage<T>(path, options)).data;
}
export type ApiPage<T> = {
  data: T;
  meta: { next_cursor?: string | null; request_id?: string; server_time?: string };
};
export async function apiPage<T>(path: string, options: RequestInit = {}): Promise<ApiPage<T>> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'AirGuard',
      ...options.headers,
    },
  });
  if (response.status === 204) return { data: undefined as T, meta: {} };
  const body = (await response.json()) as ApiPage<T> & { error?: { message: string } };
  if (!response.ok)
    throw new HttpError(response.status, body.error?.message ?? 'Không thể liên lạc API.');
  return body;
}

export async function downloadCsv(path: string, filename: string) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'AirGuard' },
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message: string } };
    throw new HttpError(response.status, body.error?.message ?? 'Không export được CSV.');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
