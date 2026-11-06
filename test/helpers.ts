import { readFileSync } from 'node:fs';
import { mergeConfig } from '../src/config.ts';
import type { Config } from '../src/types.ts';
import type { FetchLike } from '../src/http.ts';

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

export const testConfig = (over: Parameters<typeof mergeConfig>[0] = {}): Config =>
  mergeConfig({ requestDelayMs: 0, ...over });

export interface Call {
  url: string;
  init?: RequestInit;
}

/** Підмінений fetch: handler повертає тіло (рядок/об'єкт) або Response. */
export function mockFetch(handler: (url: string, init?: RequestInit) => unknown): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    if (r instanceof Response) return r;
    if (typeof r === 'string') return new Response(r, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: f, calls };
}

let seq = 1;
/** Сире оголошення OLX у форматі API. */
export function olxRaw(title: string, price: number, opts: { seller?: number; state?: 'used' | 'new'; id?: number } = {}) {
  const id = opts.id ?? seq++;
  return {
    id,
    url: `https://www.olx.ua/d/uk/obyavlenie/x-ID${id}.html`,
    title,
    category: { id: 85 },
    params: [
      { key: 'price', value: { value: price, currency: 'UAH', converted_value: null, previous_value: null } },
      { key: 'state', value: { key: opts.state ?? 'used' } },
    ],
    business: false,
    user: { id: opts.seller ?? id + 100_000 },
    location: { city: { name: 'Київ' } },
  };
}
