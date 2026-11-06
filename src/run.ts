import type { Config, Deal, Offer, PricePoint } from './types.ts';
import { errorMessage, type FetchLike } from './http.ts';
import { looksUsed, normalizeTitle, type ModelInfo } from './normalize.ts';
import { fetchOlx } from './sources/olx.ts';
import { fetchHotline } from './sources/hotline.ts';
import { fetchRozetka } from './sources/rozetka.ts';
import { fetchProm } from './sources/prom.ts';
import { prune, recordOffer, recordPricePoint, type State } from './store.ts';
import {
  displayKey,
  findAggregatorDeals,
  findBestPriceDeals,
  findOfferDeals,
  markNotified,
  selectToNotify,
  type PriceCandidate,
  type Tagged,
} from './deals.ts';
import { buildMessages, escapeHtml } from './telegram.ts';

/** Після скількох невдалих запусків поспіль надіслати попередження. */
export const ALERT_AFTER = 6;

export interface RunDeps {
  cfg: Config;
  state: State;
  now: number;
  fetch?: FetchLike;
  notify: (messages: string[]) => Promise<void>;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

export interface RunResult {
  offers: number;
  recognized: number;
  pricePoints: number;
  deals: number;
  sent: number;
  warmup: boolean;
  failedSources: string[];
}

export async function run(deps: RunDeps): Promise<RunResult> {
  const { cfg, state, now } = deps;
  const log = deps.log ?? console.log;
  const warmup = Object.keys(state.observations).length === 0 && Object.keys(state.aggregator).length === 0;
  const alerts: string[] = [];
  const failedSources: string[] = [];

  async function collect<T>(name: string, fn: () => Promise<T[]>): Promise<T[]> {
    try {
      const items = await fn();
      state.failures[name] = 0;
      log(`[${name}] отримано ${items.length}`);
      return items;
    } catch (e) {
      const n = (state.failures[name] ?? 0) + 1;
      state.failures[name] = n;
      failedSources.push(name);
      log(`[${name}] помилка (${n} поспіль): ${errorMessage(e)}`);
      if (n === ALERT_AFTER) {
        alerts.push(`⚠️ Джерело <b>${name}</b> не відповідає ${n} запусків поспіль.\n<code>${escapeHtml(errorMessage(e).slice(0, 300))}</code>`);
      }
      return [];
    }
  }

  // 1. Збір
  const offers: Offer[] = [
    ...(cfg.olx.enabled ? await collect('olx', () => fetchOlx(cfg, deps.fetch, log)) : []),
    ...(cfg.rozetka.enabled && cfg.rozetka.queries.length
      ? await collect('rozetka', () => fetchRozetka(cfg, deps.fetch, log))
      : []),
    ...(cfg.prom.enabled && cfg.prom.queries.length ? await collect('prom', () => fetchProm(cfg, deps.fetch, log)) : []),
  ];
  const points: PricePoint[] =
    cfg.hotline.enabled && cfg.hotline.urls.length
      ? await collect('hotline', () => fetchHotline(cfg, deps.fetch, log))
      : [];

  // 2. Нормалізація, фільтр моделей/стану, запис в історію
  const wanted = (info: ModelInfo, condition: Offer['condition']) =>
    (!cfg.filter.models.length || cfg.filter.models.includes(info.base)) &&
    (!cfg.filter.condition || cfg.filter.condition === condition);

  const tagged: Tagged[] = [];
  for (const offer of offers) {
    const info = normalizeTitle(offer.title, offer.storage);
    if (!info) continue;
    // продавець поставив "нове", але в заголовку "Б/У", "АКБ 92%", "Grade A"...
    if (offer.condition === 'new' && looksUsed(offer.title)) offer.condition = 'used';
    if (!wanted(info, offer.condition)) continue;
    tagged.push({ offer, info });
    recordOffer(state, offer, info.key, now);
  }
  log(`[norm] у фільтрі ${tagged.length}/${offers.length} оголошень`);

  const pointsWithInfo = points
    .map((point) => ({ point, info: normalizeTitle(point.title) }))
    .filter(({ info }) => (info ? wanted(info, 'new') : !cfg.filter.models.length));

  // Ринок для порівняння: окремо SIM / eSIM або разом (filter.ignoreEsim)
  const marketKey = (info: ModelInfo) => (cfg.filter.ignoreEsim ? info.base : info.key);

  // Найдешевший магазин на Hotline для кожної моделі — орієнтир «ринку» для нових
  const shopRef = new Map<string, number>();
  for (const { point, info } of pointsWithInfo) {
    if (info && point.lowPrice < (shopRef.get(marketKey(info)) ?? Infinity)) shopRef.set(marketKey(info), point.lowPrice);
  }

  // 3. Пошук угод
  const deals: Deal[] = [
    ...findOfferDeals(state, tagged, cfg, now, shopRef, marketKey),
    ...findAggregatorDeals(state, pointsWithInfo, cfg, now),
  ];

  // Найкраща ціна серед усіх джерел — лише коли задано конкретні моделі
  if (cfg.filter.models.length) {
    const candidates: PriceCandidate[] = [
      ...tagged
        .filter(({ offer }) => offer.condition === 'new')
        .map(({ offer, info }) => ({
          key: marketKey(info),
          label: displayKey(info, 'new'),
          price: offer.price,
          source: offer.source,
          title: offer.title,
          url: offer.url,
          seller: offer.seller,
        })),
      ...pointsWithInfo.flatMap(({ point, info }) =>
        info
          ? [{ key: marketKey(info), label: displayKey(info, 'new'), price: point.lowPrice, source: point.source, title: point.title, url: point.url }]
          : [],
      ),
    ];
    const best = findBestPriceDeals(state, candidates, cfg, now);
    // «Новий мінімум» окремої сторінки Hotline тут зайвий: його покриває найкраща ціна серед усіх джерел
    for (let i = deals.length - 1; i >= 0; i--) if (deals[i]!.kind === 'new-low') deals.splice(i, 1);
    deals.push(...best);
  }
  for (const p of points) recordPricePoint(state, p, now);

  // 4. Сповіщення
  let toSend = selectToNotify(state, deals, cfg);
  if (warmup && toSend.length) {
    log(`[deals] перший запуск: ${toSend.length} кандидатів пропущено, поки збираю ринкові ціни`);
    toSend = [];
  }
  const messages = [...alerts, ...buildMessages(toSend)];
  if (messages.length) {
    await deps.notify(messages);
    if (!deps.dryRun) markNotified(state, toSend, now);
  }
  log(`[deals] знайдено ${deals.length}, надіслано ${toSend.length}`);

  prune(state, now);
  return {
    offers: offers.length,
    recognized: tagged.length,
    pricePoints: points.length,
    deals: deals.length,
    sent: toSend.length,
    warmup,
    failedSources,
  };
}
