export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
};

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "fetch failed" сам по собі нічого не каже — додаємо причину (ENOTFOUND, ECONNRESET, timeout...). */
export function errorMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause as { code?: string; message?: string } | undefined;
  const why = cause?.code ?? cause?.message;
  return why && !e.message.includes(why) ? `${e.message} (${why})` : e.message;
}

/** GET з таймаутом і повторами на 429/5xx/мережеві збої. */
export async function get(
  url: string,
  opts: { fetch?: FetchLike; accept?: string; retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const f = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, {
        headers: { ...BROWSER_HEADERS, Accept: opts.accept ?? '*/*' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, url);
      lastErr = new HttpError(res.status, url);
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < retries) await sleep(2_000 * 2 ** attempt);
  }
  throw lastErr;
}

export async function getJson<T>(url: string, opts: Parameters<typeof get>[1] = {}): Promise<T> {
  const res = await get(url, { ...opts, accept: 'application/json' });
  return (await res.json()) as T;
}

export async function getText(url: string, opts: Parameters<typeof get>[1] = {}): Promise<string> {
  const res = await get(url, { ...opts, accept: 'text/html,application/xhtml+xml' });
  return res.text();
}
