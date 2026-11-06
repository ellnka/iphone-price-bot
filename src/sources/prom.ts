import type { Config, Offer } from '../types.ts';
import { getText, sleep, type FetchLike } from '../http.ts';
import { looksUsed } from '../normalize.ts';
import { extractProducts } from './jsonld.ts';

/**
 * Prom.ua — маркетплейс із сотнями магазинів. Сторінка пошуку віддає товари
 * як schema.org Product у JSON-LD (назва, ціна, наявність, продавець).
 *
 * Перевірено наживо (листопад 2026):
 *  - https://prom.ua/ua/search?search_term=...&sort=price&page=N — 10 товарів на сторінку, приблизно від найдешевших;
 *  - найдешевші — переважно вживані, нові 17 Pro 256 з'являються на 4-й сторінці → pages: 5;
 *  - окремого поля "стан" немає → вживані визначаємо за заголовком ("Б/У", "Grade B", "27 циклів"...).
 */
export function buildPromUrl(query: string, page: number): string {
  const p = new URLSearchParams({ search_term: query, sort: 'price' });
  if (page > 1) p.set('page', String(page));
  return `https://prom.ua/ua/search?${p}`;
}

/** "https://prom.ua/ua/m-2830928199945905395-smartfon-iphone-pro.html" → "m-2830928199945905395" */
const promId = (url: string) => url.match(/\/(m-?\d+)/)?.[1] ?? url;

export function parsePromSearch(html: string): Offer[] {
  const out: Offer[] = [];
  for (const p of extractProducts(html)) {
    if (!p.url || !p.price) continue;
    if (p.availability && p.availability !== 'InStock') continue; // PreOrder / OutOfStock
    out.push({
      source: 'prom',
      id: promId(p.url),
      title: p.name,
      price: Math.round(p.price),
      url: p.url,
      condition: looksUsed(p.name) ? 'used' : 'new',
      sellerId: p.seller,
      seller: p.seller,
    });
  }
  return out;
}

export async function fetchProm(cfg: Config, fetchImpl?: FetchLike, log = console.log): Promise<Offer[]> {
  const out = new Map<string, Offer>();
  for (const q of cfg.prom.queries) {
    for (let page = 1; page <= cfg.prom.pages; page++) {
      const html = await getText(buildPromUrl(q, page), { fetch: fetchImpl });
      await sleep(cfg.requestDelayMs);
      const items = parsePromSearch(html);
      if (page === 1 && items.length === 0) log(`[prom] "${q}": 0 товарів — можливо, змінилась сторінка пошуку`);
      for (const o of items) out.set(o.id, o);
      if (items.length === 0) break;
    }
  }
  return [...out.values()];
}
