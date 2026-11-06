import type { Config, Offer } from '../types.ts';
import { getJson, sleep, type FetchLike } from '../http.ts';

/**
 * OLX.ua віддає оголошення через JSON-ендпоінт, який використовує сам сайт:
 *   https://www.olx.ua/api/v1/offers/?query=...&offset=0&limit=50&currency=UAH
 * Це не офіційний публічний API — структура може змінитися.
 *
 * Перевірено наживо (листопад 2026):
 *  - category_id=85 — "Мобільні телефони", відсікає аксесуари і запчастини;
 *  - sort_by=created_at:desc — свіжі/підняті оголошення першими;
 *  - limit=50 повертає до ~65 записів: платні (top_ad) додаються зверху;
 *  - params: price, state, storage {key:"256gb"}, condition_grade {key:"like_new"|...|"defects"},
 *    battery_health {label:"85–89%"}.
 */
const BASE = 'https://www.olx.ua/api/v1/offers/';

interface OlxPriceValue {
  value?: number | null;
  currency?: string;
  converted_value?: number | null;
  previous_value?: number | null;
  converted_previous_value?: number | null;
  arranged?: boolean;
}

export interface OlxOffer {
  id: number;
  url: string;
  title: string;
  created_time?: string;
  business?: boolean;
  user?: { id?: number };
  location?: { city?: { name?: string } };
  category?: { id?: number };
  params?: Array<{ key: string; value: unknown }>;
}

interface OlxResponse {
  data: OlxOffer[];
  links?: { next?: { href: string } };
}

export function buildUrl(query: string, offset: number, limit: number, categoryId?: number): string {
  const p = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
    query,
    currency: 'UAH',
    sort_by: 'created_at:desc',
  });
  if (categoryId) p.set('category_id', String(categoryId));
  return `${BASE}?${p}`;
}

function uah(v: OlxPriceValue, raw: 'value' | 'previous_value'): number | undefined {
  const conv = raw === 'value' ? v.converted_value : v.converted_previous_value;
  const val = v[raw];
  if (v.currency && v.currency !== 'UAH') return conv ?? undefined;
  return val ?? conv ?? undefined;
}

export function mapOlxOffer(o: OlxOffer): Offer | null {
  const priceParam = o.params?.find((p) => p.key === 'price')?.value as OlxPriceValue | undefined;
  if (!priceParam) return null;
  // arranged ("договірна") часто йде разом із конкретною ціною — тоді її беремо
  const price = uah(priceParam, 'value');
  if (!price) return null;

  const prev = uah(priceParam, 'previous_value');
  const param = (k: string) => o.params?.find((p) => p.key === k)?.value as { key?: string; label?: string } | undefined;
  const state = param('state')?.key;
  const grade = param('condition_grade')?.key;

  return {
    source: 'olx',
    id: String(o.id),
    title: o.title,
    price: Math.round(price),
    previousPrice: prev && prev > price ? Math.round(prev) : undefined,
    url: o.url,
    condition: state === 'new' ? 'new' : 'used',
    sellerId: o.user?.id != null ? String(o.user.id) : undefined,
    business: o.business,
    city: o.location?.city?.name,
    createdAt: o.created_time,
    storage: param('storage')?.key,
    grade: grade ? (GRADES[grade] ?? grade) : undefined,
    battery: param('battery_health')?.label,
  };
}

/** Поле OLX "condition_grade" → людською мовою. */
export const GRADES: Record<string, string> = {
  like_new: 'як новий',
  very_good: 'дуже добрий',
  good: 'добрий',
  defects: 'з дефектами',
  for_parts: 'на запчастини',
};

export async function fetchOlx(cfg: Config, fetchImpl?: FetchLike, log = console.log): Promise<Offer[]> {
  const c = cfg.olx;
  const out = new Map<string, Offer>();

  for (const query of c.queries) {
    let categoryId: number | undefined = c.categoryId || undefined;

    for (let page = 0; page < c.pages; page++) {
      const url = buildUrl(query, page * c.pageSize, c.pageSize, categoryId);
      const res = await getJson<OlxResponse>(url, { fetch: fetchImpl });
      await sleep(cfg.requestDelayMs);

      // Якщо категорію змінили і фільтр дав порожньо — повторюємо без неї,
      // а відсіюємо по category.id на нашому боці.
      if (page === 0 && categoryId && res.data.length === 0) {
        log(`[olx] "${query}": 0 результатів з category_id=${categoryId}, пробую без категорії`);
        categoryId = undefined;
        page--;
        continue;
      }

      for (const raw of res.data) {
        if (c.categoryId && raw.category?.id && raw.category.id !== c.categoryId) continue;
        if (c.skipBusiness && raw.business) continue;
        const o = mapOlxOffer(raw);
        if (!o || o.price < c.minPrice) continue;
        if (c.skipDefects && (o.grade === GRADES.defects || o.grade === GRADES.for_parts)) continue;
        out.set(o.id, o);
      }
      if (res.data.length < c.pageSize || !res.links?.next) break;
    }
  }
  return [...out.values()];
}
