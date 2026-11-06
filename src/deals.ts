import type { Config, Deal, Offer, PricePoint, WatchRule } from './types.ts';
import type { ModelInfo } from './normalize.ts';
import { groupKey, marketPrices, recordBest, type State } from './store.ts';

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export interface Tagged {
  offer: Offer;
  info: ModelInfo;
}

/** "iphone 17 pro 256gb eSIM (нове)" */
export const displayKey = (info: ModelInfo, condition: Offer['condition']) =>
  `${info.base}${info.esim ? ' eSIM' : ''} (${condition === 'new' ? 'нове' : 'вживане'})`;

const notifyKeyOf = (x: Deal) => x.notifyKey ?? `${x.source}:${x.id}`;

function matchesRule(r: WatchRule, info: ModelInfo, condition: Offer['condition']): boolean {
  if (r.model.toLowerCase().trim().replace(/\s+/g, ' ') !== info.model) return false;
  if (r.storage && r.storage.toLowerCase().replace(/\s+/g, '') !== info.storage) return false;
  if (r.condition && r.condition !== condition) return false;
  return true;
}

/**
 * Оголошення, які дешевші за ринок АБО нижчі за поріг користувача.
 * "Ринок" для нового телефона — найдешевший магазин на Hotline (shopRef), якщо він відомий;
 * інакше (і для вживаних) — медіана схожих оголошень за windowDays.
 */
export function findOfferDeals(
  state: State,
  items: Tagged[],
  cfg: Config,
  now: number,
  shopRef: Map<string, number> = new Map(),
  refKey: (info: ModelInfo) => string = (info) => info.key,
): Deal[] {
  const d = cfg.deals;
  const deals: Deal[] = [];

  for (const { offer: o, info } of items) {
    const shop = o.condition === 'new' ? shopRef.get(refKey(info)) : undefined;
    let reference: number | undefined;
    let referenceLabel: string | undefined;
    let threshold = d.minDiscount;

    if (shop) {
      reference = shop;
      referenceLabel = 'найдешевший магазин на Hotline';
      threshold = d.minDiscountVsShops;
    } else {
      const prices = marketPrices(state, groupKey(info.key, o.condition), d.windowDays, now, {
        key: `${o.source}:${o.id}`,
        sellerId: o.sellerId,
      });
      reference = prices.length >= d.minSamples ? median(prices) : undefined;
    }
    const discount = reference ? (reference - o.price) / reference : undefined;

    // підозріло дешево — найчастіше шахрайство або «на запчастини» без слова в заголовку
    if (discount !== undefined && discount > d.maxDiscount) continue;

    const rule = cfg.watch.find((r) => matchesRule(r, info, o.condition) && o.price <= r.maxPrice);
    const isMarketDeal = discount !== undefined && discount >= threshold;
    if (!rule && !isMarketDeal) continue;

    deals.push({
      kind: rule ? 'watch' : 'market',
      source: o.source,
      id: o.id,
      modelKey: displayKey(info, o.condition),
      title: o.title,
      price: o.price,
      url: o.url,
      reference,
      referenceLabel,
      discount,
      previousPrice: o.previousPrice,
      city: o.city,
      note: rule ? `твій поріг ≤ ${rule.maxPrice}` : undefined,
      details: [o.grade && `стан: ${o.grade}`, o.battery && `АКБ ${o.battery}`].filter(Boolean).join(' · ') || undefined,
      sellerId: o.sellerId,
      seller: o.seller,
    });
  }
  return onePerSeller(deals);
}

/**
 * Продавці часто виставляють той самий телефон кількома оголошеннями.
 * Лишаємо одне (найдешевше) на продавця й модель — інакше прийде кілька однакових сповіщень.
 */
function onePerSeller(deals: Deal[]): Deal[] {
  const best = new Map<string, Deal>();
  for (const d of deals) {
    const k = `${d.source}:${d.sellerId ?? d.id}:${d.modelKey}`;
    const cur = best.get(k);
    if (!cur || d.price < cur.price || (d.price === cur.price && d.id < cur.id)) best.set(k, d);
  }
  return [...best.values()];
}

/** Агрегатор: новий мінімум за 30 днів або ціна нижча за поріг користувача. */
export function findAggregatorDeals(
  state: State,
  points: Array<{ point: PricePoint; info: ModelInfo | null }>,
  cfg: Config,
  now: number,
): Deal[] {
  const deals: Deal[] = [];
  const since = now - 30 * 86_400_000;

  for (const { point: p, info } of points) {
    const hist = (state.aggregator[p.url] ?? []).filter((h) => h.at >= since && h.at < now);
    const prevMin = hist.length >= 3 ? Math.min(...hist.map((h) => h.low)) : undefined;
    const isNewLow = prevMin !== undefined && p.lowPrice <= prevMin * (1 - cfg.hotline.minDrop);
    const rule = info ? cfg.watch.find((r) => matchesRule(r, info, 'new') && p.lowPrice <= r.maxPrice) : undefined;
    if (!isNewLow && !rule) continue;

    deals.push({
      kind: isNewLow ? 'new-low' : 'watch',
      source: p.source,
      id: p.url,
      modelKey: info ? displayKey(info, 'new') : p.title,
      title: p.title,
      price: p.lowPrice,
      url: p.url,
      reference: prevMin,
      discount: prevMin ? (prevMin - p.lowPrice) / prevMin : undefined,
      note: [
        isNewLow ? 'мінімум за 30 днів' : undefined,
        rule ? `твій поріг ≤ ${rule.maxPrice}` : undefined,
        p.offerCount ? `${p.offerCount} пропозицій` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return deals;
}

export interface PriceCandidate {
  key: string; // ModelInfo.key
  label: string; // displayKey
  price: number;
  source: string;
  title: string;
  url: string;
  seller?: string;
}

/**
 * Найкраща ціна моделі серед УСІХ джерел (Hotline, Rozetka, Prom, OLX-нові).
 * Сповіщаємо, коли вона опускається нижче мінімуму за 30 днів на bestMinDrop.
 * Записує поточний мінімум в історію (state.best).
 */
export function findBestPriceDeals(state: State, candidates: PriceCandidate[], cfg: Config, now: number): Deal[] {
  const byKey = new Map<string, PriceCandidate[]>();
  for (const c of candidates) (byKey.get(c.key) ?? byKey.set(c.key, []).get(c.key)!).push(c);

  const deals: Deal[] = [];
  const since = now - 30 * 86_400_000;
  for (const [key, list] of byKey) {
    const best = list.reduce((a, b) => (b.price < a.price ? b : a));
    const hist = (state.best[key] ?? []).filter((h) => h.at >= since && h.at < now);
    const prevMin = hist.length >= 3 ? Math.min(...hist.map((h) => h.low)) : undefined;
    recordBest(state, key, best.price, now);
    if (prevMin === undefined || best.price > prevMin * (1 - cfg.deals.bestMinDrop)) continue;

    deals.push({
      kind: 'best',
      source: best.source,
      id: best.url,
      notifyKey: `best:${key}`,
      modelKey: best.label,
      title: best.title,
      price: best.price,
      url: best.url,
      reference: prevMin,
      referenceLabel: 'мін. за 30 днів',
      discount: (prevMin - best.price) / prevMin,
      seller: best.seller,
      note: `найнижча ціна серед ${list.length} пропозицій`,
    });
  }
  return deals;
}

/** Прибирає вже надіслані (якщо ціна не впала ще на renotifyDrop) і сортує. */
export function selectToNotify(state: State, deals: Deal[], cfg: Config): Deal[] {
  const fresh = deals.filter((x) => {
    const prev = state.notified[notifyKeyOf(x)];
    return !prev || x.price <= prev.price * (1 - cfg.deals.renotifyDrop);
  });
  const score = (x: Deal) => (x.kind === 'watch' || x.kind === 'best' ? 1 : 0) + (x.discount ?? 0);
  return fresh.sort((a, b) => score(b) - score(a)).slice(0, cfg.deals.maxPerRun);
}

export function markNotified(state: State, deals: Deal[], now: number): void {
  for (const x of deals) state.notified[notifyKeyOf(x)] = { price: x.price, at: now };
}
