import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Condition, Offer, PricePoint } from './types.ts';

const DAY = 86_400_000;

export interface Observation {
  source: string;
  id: string;
  modelKey: string; // "iphone 16 pro 256gb"
  condition: Condition;
  price: number;
  sellerId?: string;
  firstSeen: number;
  lastSeen: number;
}

export interface State {
  version: 1;
  observations: Record<string, Observation>; // `${source}:${id}`
  notified: Record<string, { price: number; at: number }>;
  aggregator: Record<string, Array<{ at: number; low: number }>>; // url -> історія мінімумів
  /** модель -> історія найкращої ціни серед усіх джерел (лише для filter.models) */
  best: Record<string, Array<{ at: number; low: number }>>;
  failures: Record<string, number>; // джерело -> кількість невдалих запусків поспіль
}

export const emptyState = (): State => ({
  version: 1,
  observations: {},
  notified: {},
  aggregator: {},
  best: {},
  failures: {},
});

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as Partial<State>;
    return { ...emptyState(), ...s, version: 1 };
  } catch {
    console.warn(`[store] ${path} пошкоджений — починаю з порожнього стану`);
    return emptyState();
  }
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path); // атомарно: не залишимо напівзаписаний файл
}

export const groupKey = (modelKey: string, condition: Condition) => `${modelKey}|${condition}`;

export function recordOffer(state: State, o: Offer, modelKey: string, now: number): void {
  const k = `${o.source}:${o.id}`;
  const prev = state.observations[k];
  state.observations[k] = {
    source: o.source,
    id: o.id,
    modelKey,
    condition: o.condition,
    price: o.price,
    sellerId: o.sellerId,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
  };
}

function pushHistory(h: Array<{ at: number; low: number }>, price: number, now: number): void {
  const last = h.at(-1);
  // не роздуваємо історію: однакова ціна пишеться не частіше ніж раз на 6 год
  if (last && last.low === price && now - last.at < 6 * 3_600_000) return;
  h.push({ at: now, low: price });
}

export function recordPricePoint(state: State, p: PricePoint, now: number): void {
  pushHistory((state.aggregator[p.url] ??= []), p.lowPrice, now);
}

export function recordBest(state: State, modelKey: string, price: number, now: number): void {
  pushHistory((state.best[modelKey] ??= []), price, now);
}

/**
 * Ціни по групі (модель+пам'ять+стан) за вікно. Один продавець = один голос
 * (беремо його найсвіжіше оголошення), щоб перевиставлення не зсували медіану.
 */
export function marketPrices(
  state: State,
  group: string,
  windowDays: number,
  now: number,
  exclude?: { key: string; sellerId?: string },
): number[] {
  const since = now - windowDays * DAY;
  const bySeller = new Map<string, Observation>();
  for (const [k, o] of Object.entries(state.observations)) {
    if (o.lastSeen < since || groupKey(o.modelKey, o.condition) !== group) continue;
    // сам кандидат і інші оголошення того ж продавця не впливають на «ринок»
    if (exclude && (k === exclude.key || (exclude.sellerId && o.sellerId === exclude.sellerId))) continue;
    const who = o.sellerId ? `${o.source}:u${o.sellerId}` : `${o.source}:${o.id}`;
    const cur = bySeller.get(who);
    if (!cur || o.lastSeen > cur.lastSeen) bySeller.set(who, o);
  }
  return [...bySeller.values()].map((o) => o.price);
}

export function prune(state: State, now: number, keepDays = 30): void {
  const since = now - keepDays * DAY;
  for (const [k, o] of Object.entries(state.observations)) if (o.lastSeen < since) delete state.observations[k];
  for (const [k, n] of Object.entries(state.notified)) if (n.at < since) delete state.notified[k];
  for (const hist of [state.aggregator, state.best]) {
    for (const [k, h] of Object.entries(hist)) {
      const kept = h.filter((x) => x.at >= now - 60 * DAY);
      if (kept.length) hist[k] = kept;
      else delete hist[k];
    }
  }
}
