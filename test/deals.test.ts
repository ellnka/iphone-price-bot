import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findAggregatorDeals, findOfferDeals, markNotified, median, selectToNotify, type Tagged } from '../src/deals.ts';
import { emptyState, recordOffer, recordPricePoint, prune, marketPrices, groupKey } from '../src/store.ts';
import { normalizeTitle } from '../src/normalize.ts';
import type { Offer } from '../src/types.ts';
import { testConfig } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 6, 12);
const H = 3_600_000;

let n = 0;
function offer(title: string, price: number, extra: Partial<Offer> = {}): Offer {
  n++;
  return { source: 'olx', id: String(n), title, price, url: `https://x/${n}`, condition: 'used', sellerId: `s${n}`, ...extra };
}
function tag(o: Offer): Tagged {
  return { offer: o, info: normalizeTitle(o.title)! };
}
/** Заповнює ринок: N продавців з цінами навколо base. */
function seedMarket(state = emptyState(), title: string, prices: number[]) {
  for (const p of prices) {
    const o = offer(title, p);
    recordOffer(state, o, normalizeTitle(title)!.key, NOW - 2 * H);
  }
  return state;
}

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 3); // (2+3)/2 = 2.5 → округлення
  assert.equal(median([10]), 10);
});

test('ринкова угода: −15% від медіани → так (поріг 12%); −5% → ні', () => {
  const state = seedMarket(undefined, 'iPhone 15 Pro 256', [30000, 31000, 29500, 30500, 30000, 29000, 31500]);
  const cfg = testConfig({ deals: { minDiscount: 0.12 } });
  const cheap = tag(offer('iPhone 15 Pro 256GB', 25500));
  const meh = tag(offer('iPhone 15 Pro 256GB', 28500));
  for (const t of [cheap, meh]) recordOffer(state, t.offer, t.info.key, NOW);

  const deals = findOfferDeals(state, [cheap, meh], cfg, NOW);
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.price, 25500);
  assert.equal(deals[0]!.reference, 30000);
  assert.equal(deals[0]!.kind, 'market');
  assert.ok(Math.abs(deals[0]!.discount! - 0.15) < 0.001);

  // за замовчуванням поріг 20% — −15% вже не угода
  assert.equal(findOfferDeals(state, [cheap], testConfig(), NOW).length, 0);
});

test('занадто дешево (>45%) — ігноруємо навіть з порогом користувача', () => {
  const state = seedMarket(undefined, 'iPhone 15 Pro 256', [30000, 31000, 29500, 30500, 30000, 29000]);
  const cfg = testConfig({ watch: [{ model: 'iphone 15 pro', maxPrice: 26000 }] });
  const scam = tag(offer('iPhone 15 Pro 256', 12000));
  assert.equal(findOfferDeals(state, [scam], cfg, NOW).length, 0);
});

test('мало даних → ринкових угод немає, але поріг користувача спрацьовує', () => {
  const state = seedMarket(undefined, 'iPhone 16 Pro 256', [40000, 41000]);
  const cfg = testConfig({ watch: [{ model: 'iPhone 16 Pro', storage: '256 GB', condition: 'used', maxPrice: 36000 }] });
  const t = tag(offer('iPhone 16 Pro 256', 35000));
  const deals = findOfferDeals(state, [t], cfg, NOW);
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.kind, 'watch');
  assert.equal(deals[0]!.reference, undefined);

  // інший стан / пам'ять — правило не підходить
  const other = tag(offer('iPhone 16 Pro 512', 35000));
  assert.equal(findOfferDeals(state, [other], cfg, NOW).length, 0);
  const isNew = tag(offer('iPhone 16 Pro 256', 35000, { condition: 'new' }));
  assert.equal(findOfferDeals(state, [isNew], cfg, NOW).length, 0);
});

test('нове і вживане — різні ринки', () => {
  const state = seedMarket(undefined, 'iPhone 15 128', [20000, 20500, 21000, 19500, 20000, 20800]);
  const cfg = testConfig();
  // нове за 17000 — порівнювати нема з чим (ринок «нових» порожній)
  const t = tag(offer('iPhone 15 128', 17000, { condition: 'new' }));
  assert.equal(findOfferDeals(state, [t], cfg, NOW).length, 0);
});

test('один продавець = один голос; сам кандидат і його інші оголошення не рахуються', () => {
  const state = emptyState();
  const key = normalizeTitle('iPhone 14 128')!.key;
  // спамер виставив 10 оголошень по 15000
  for (let i = 0; i < 10; i++) recordOffer(state, offer('iPhone 14 128', 15000, { sellerId: 'spam' }), key, NOW);
  for (const p of [18000, 18500, 17500, 18200, 17800]) recordOffer(state, offer('iPhone 14 128', p), key, NOW);
  const prices = marketPrices(state, groupKey(key, 'used'), 7, NOW, { key: 'olx:none', sellerId: 'spam' });
  assert.deepEqual(prices.sort(), [17500, 17800, 18000, 18200, 18500]);
  assert.equal(marketPrices(state, groupKey(key, 'used'), 7, NOW).length, 6);
});

test('старі спостереження поза вікном не впливають', () => {
  const state = emptyState();
  const key = normalizeTitle('iPhone 13 128')!.key;
  for (const p of [15000, 15500, 14800, 15200, 15100, 14900]) recordOffer(state, offer('iPhone 13 128', p), key, NOW - 10 * 24 * H);
  assert.equal(marketPrices(state, groupKey(key, 'used'), 7, NOW).length, 0);
});

test('повторно не надсилаємо, якщо ціна не впала ще на 3%', () => {
  const state = emptyState();
  const cfg = testConfig();
  const d = { kind: 'market' as const, source: 'olx', id: '1', modelKey: 'k', title: 't', price: 20000, url: 'u', discount: 0.2 };
  assert.equal(selectToNotify(state, [d], cfg).length, 1);
  markNotified(state, [d], NOW);
  assert.equal(selectToNotify(state, [d], cfg).length, 0);
  assert.equal(selectToNotify(state, [{ ...d, price: 19700 }], cfg).length, 0);
  assert.equal(selectToNotify(state, [{ ...d, price: 19400 }], cfg).length, 1);
});

test('сортування: пороги користувача вище, далі за розміром знижки; ліміт maxPerRun', () => {
  const cfg = testConfig({ deals: { maxPerRun: 2 } });
  const base = { source: 'olx', modelKey: 'k', title: 't', price: 1, url: 'u' };
  const out = selectToNotify(
    emptyState(),
    [
      { ...base, kind: 'market', id: 'a', discount: 0.2 },
      { ...base, kind: 'market', id: 'b', discount: 0.35 },
      { ...base, kind: 'watch', id: 'c' },
    ],
    cfg,
  );
  assert.deepEqual(out.map((x) => x.id), ['c', 'b']);
});

test('агрегатор: новий мінімум за 30 днів', () => {
  const state = emptyState();
  const url = 'https://hotline.ua/ua/x/';
  const p = (low: number) => ({ source: 'hotline', url, title: 'Apple iPhone 15 128GB Black', lowPrice: low });
  recordPricePoint(state, p(24000), NOW - 72 * H);
  recordPricePoint(state, p(23800), NOW - 48 * H);
  recordPricePoint(state, p(23900), NOW - 24 * H);
  const cfg = testConfig();
  const info = normalizeTitle('Apple iPhone 15 128GB Black');

  assert.equal(findAggregatorDeals(state, [{ point: p(23500), info }], cfg, NOW).length, 0); // −1.3%
  const deals = findAggregatorDeals(state, [{ point: p(22900), info }], cfg, NOW); // −3.8%
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.kind, 'new-low');
  assert.equal(deals[0]!.reference, 23800);
  assert.equal(deals[0]!.modelKey, 'iphone 15 128gb (нове)');
});

test('агрегатор: поріг користувача для нового', () => {
  const cfg = testConfig({ watch: [{ model: 'iphone 15', storage: '128gb', condition: 'new', maxPrice: 24000 }] });
  const point = { source: 'hotline', url: 'u', title: 'Apple iPhone 15 128GB Black', lowPrice: 23990 };
  const deals = findAggregatorDeals(emptyState(), [{ point, info: normalizeTitle(point.title) }], cfg, NOW);
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.kind, 'watch');
});

test('recordPricePoint не дублює однакову ціну частіше ніж раз на 6 год', () => {
  const state = emptyState();
  const p = { source: 'hotline', url: 'u', title: 't', lowPrice: 100 };
  recordPricePoint(state, p, NOW);
  recordPricePoint(state, p, NOW + H);
  recordPricePoint(state, { ...p, lowPrice: 99 }, NOW + 2 * H);
  recordPricePoint(state, { ...p, lowPrice: 99 }, NOW + 9 * H);
  assert.equal(state.aggregator.u!.length, 3);
});

test('prune видаляє старе', () => {
  const state = emptyState();
  recordOffer(state, offer('iPhone 13 128', 1), 'k', NOW - 40 * 24 * H);
  recordOffer(state, offer('iPhone 13 128', 1), 'k', NOW);
  state.notified['olx:old'] = { price: 1, at: NOW - 40 * 24 * H };
  state.aggregator.old = [{ at: NOW - 70 * 24 * H, low: 1 }];
  prune(state, NOW);
  assert.equal(Object.keys(state.observations).length, 1);
  assert.equal(Object.keys(state.notified).length, 0);
  assert.equal(state.aggregator.old, undefined);
});

test('один продавець з кількома однаковими оголошеннями → одне сповіщення (найдешевше)', () => {
  const state = seedMarket(undefined, 'iPhone 17 Pro Max 512', [56000, 57000, 55000, 58000, 56500, 57500]);
  const cfg = testConfig({ deals: { minDiscount: 0.12 } });
  const a = tag(offer('Продам IPHONE 17 PRO MAX 512 Neverlock', 45999, { sellerId: 'dup' }));
  const b = tag(offer('iPhone 17 Pro Max 512 ГБ Neverlock', 45000, { sellerId: 'dup' }));
  for (const t of [a, b]) recordOffer(state, t.offer, t.info.key, NOW);
  const deals = findOfferDeals(state, [a, b], cfg, NOW);
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.price, 45000);
});
