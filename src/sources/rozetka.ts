import type { Config, Offer } from '../types.ts';
import { getJson, sleep, type FetchLike } from '../http.ts';

/**
 * Rozetka — JSON API, яке використовує сам сайт (не публічне, може змінитися).
 * Перевірено наживо (листопад 2026):
 *  1. GET common-api.rozetka.com.ua/v1/api/catalog/search?text=... → data.goods[{id}]
 *     (іноді спершу повертає data.meta.navigateTo з section_id — тоді повторюємо з ним);
 *  2. GET common-api.rozetka.com.ua/v1/api/product/details?ids=1,2,3 → data[{title, price, href,
 *     sell_status: "available"|"unavailable", state: "new"|"used"|"refurbished", seller_id}].
 *  seller_id 5 — сама Rozetka, інші — продавці маркетплейсу.
 */
const API = 'https://common-api.rozetka.com.ua';
const COMMON = { country: 'UA', lang: 'ua', platform: 'desktop' };

interface SearchResponse {
  data?: {
    goods?: Array<{ id: number }>;
    meta?: { navigateTo?: { query?: Record<string, string> } };
  };
}

export interface RozetkaGoods {
  id: number;
  title: string;
  href: string;
  price: number;
  old_price?: number;
  sell_status?: string;
  state?: string;
  seller_id?: number;
  seller?: { title?: string } | null;
}

export function mapRozetka(g: RozetkaGoods): Offer | null {
  if (!g.price || g.sell_status !== 'available') return null;
  return {
    source: 'rozetka',
    id: String(g.id),
    title: g.title,
    price: Math.round(g.price),
    previousPrice: g.old_price && g.old_price > g.price ? Math.round(g.old_price) : undefined,
    url: g.href,
    condition: g.state === 'new' ? 'new' : 'used', // refurbished теж вважаємо не новим
    sellerId: g.seller_id != null ? String(g.seller_id) : undefined,
    seller: g.seller_id === 5 ? 'Rozetka' : (g.seller?.title ?? undefined),
  };
}

async function searchIds(query: string, f?: FetchLike): Promise<number[]> {
  let params: Record<string, string> = { ...COMMON, page: '1', text: query };
  for (let hop = 0; hop < 2; hop++) {
    const res = await getJson<SearchResponse>(`${API}/v1/api/catalog/search?${new URLSearchParams(params)}`, { fetch: f });
    if (res.data?.goods) return res.data.goods.map((g) => g.id);
    const nav = res.data?.meta?.navigateTo?.query;
    if (!nav) break;
    params = { ...COMMON, ...nav }; // перенаправлення в категорію (section_id)
  }
  return [];
}

export async function fetchRozetka(cfg: Config, fetchImpl?: FetchLike, log = console.log): Promise<Offer[]> {
  const out = new Map<string, Offer>();
  for (const q of cfg.rozetka.queries) {
    const ids = await searchIds(q, fetchImpl);
    await sleep(cfg.requestDelayMs);
    if (!ids.length) {
      log(`[rozetka] "${q}": 0 товарів`);
      continue;
    }
    const p = new URLSearchParams({ ...COMMON, ids: ids.slice(0, 60).join(',') });
    const res = await getJson<{ data?: RozetkaGoods[] }>(`${API}/v1/api/product/details?${p}`, { fetch: fetchImpl });
    await sleep(cfg.requestDelayMs);
    for (const g of res.data ?? []) {
      const o = mapRozetka(g);
      if (o) out.set(o.id, o);
    }
  }
  return [...out.values()];
}
