import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, ALERT_AFTER } from '../src/run.ts';
import { emptyState, loadState, saveState } from '../src/store.ts';
import { mockFetch, olxRaw, testConfig } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 6, 12);
const MIN = 60_000;
const silent = () => {};

/** Ринок iPhone 15 Pro 256 навколо 30 000 від різних продавців. */
const market = () => [30000, 31000, 29500, 30500, 30000, 29000, 31500].map((p, i) => olxRaw('iPhone 15 Pro 256GB', p, { id: 1000 + i }));

const cfg = testConfig({ olx: { queries: ['iphone 15 pro'], pages: 1 }, hotline: { enabled: false } });

test('повний цикл: прогрів → угода → без дублів', async () => {
  const state = emptyState();
  const sent: string[][] = [];
  const notify = async (m: string[]) => void sent.push(m);

  // 1-й запуск: лише ринок, нічого не надсилаємо (прогрів)
  let olx = mockFetch(() => ({ data: market() }));
  let r = await run({ cfg, state, now: NOW, fetch: olx.fetch, notify, log: silent });
  assert.equal(r.warmup, true);
  assert.equal(r.recognized, 7);
  assert.equal(sent.length, 0);

  // 2-й запуск: з'явилось вигідне оголошення + аксесуар + підозріло дешеве
  const fresh = [
    ...market(),
    olxRaw('iPhone 15 Pro 256 Neverlock, АКБ 96%', 23500, { id: 2001 }),
    olxRaw('Чохол iPhone 15 Pro', 5500, { id: 2002 }),
    olxRaw('iPhone 15 Pro 256', 9000, { id: 2003 }),
  ];
  olx = mockFetch(() => ({ data: fresh }));
  r = await run({ cfg, state, now: NOW + 30 * MIN, fetch: olx.fetch, notify, log: silent });
  assert.equal(r.warmup, false);
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0]![0]!, /23\s500 ₴/);
  assert.match(sent[0]![0]!, /−22%/);

  // 3-й запуск: те саме — повторно не надсилаємо
  r = await run({ cfg, state, now: NOW + 60 * MIN, fetch: olx.fetch, notify, log: silent });
  assert.equal(r.sent, 0);
  assert.equal(sent.length, 1);

  // 4-й: продавець знизив ще на 6% — надсилаємо знову
  const cheaper = fresh.map((o) => (o.id === 2001 ? olxRaw(o.title, 22000, { id: 2001 }) : o));
  olx = mockFetch(() => ({ data: cheaper }));
  r = await run({ cfg, state, now: NOW + 90 * MIN, fetch: olx.fetch, notify, log: silent });
  assert.equal(r.sent, 1);
});

test('dry-run не позначає як надіслане', async () => {
  const state = emptyState();
  const notify = async () => {};
  const data = [...market(), olxRaw('iPhone 15 Pro 256', 23500, { id: 3001 })];
  const { fetch } = mockFetch(() => ({ data }));
  await run({ cfg, state, now: NOW, fetch, notify, log: silent }); // прогрів
  const r = await run({ cfg, state, now: NOW + MIN, fetch, notify, dryRun: true, log: silent });
  assert.equal(r.sent, 1);
  assert.equal(Object.keys(state.notified).length, 0);
});

test(`джерело падає ${ALERT_AFTER} разів поспіль → одне попередження`, async () => {
  const state = emptyState();
  const sent: string[] = [];
  const { fetch } = mockFetch(() => new Response('blocked', { status: 403 }));
  for (let i = 0; i < ALERT_AFTER + 2; i++) {
    const r = await run({ cfg, state, now: NOW + i * 30 * MIN, fetch, notify: async (m) => void sent.push(...m), log: silent });
    assert.deepEqual(r.failedSources, ['olx']);
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /olx<\/b> не відповідає 6 запусків/);

  // відновилось — лічильник скинувся
  const ok = mockFetch(() => ({ data: market() }));
  await run({ cfg, state, now: NOW + 10 * 30 * MIN, fetch: ok.fetch, notify: async () => {}, log: silent });
  assert.equal(state.failures.olx, 0);
});

test('стан зберігається і читається', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pb-'));
  const path = join(dir, 'nested', 'state.json');
  const s = emptyState();
  s.notified['olx:1'] = { price: 1, at: 2 };
  saveState(path, s);
  assert.deepEqual(loadState(path).notified, s.notified);
  assert.deepEqual(loadState(join(dir, 'missing.json')), emptyState());
  // пошкоджений файл → порожній стан, без падіння
  saveState(path, s);
  writeFileSync(path, readFileSync(path, 'utf8').slice(0, 10));
  assert.deepEqual(loadState(path), emptyState());
});

test('17 Pro 256 нові: фільтр моделі/стану, орієнтир Hotline, найкраща ціна серед джерел', async () => {
  const cfg17 = testConfig({
    olx: { enabled: true, queries: ['iphone 17 pro 256'], pages: 1 },
    hotline: { enabled: true, urls: ['https://hotline.ua/ua/x/17pro-silver/', 'https://hotline.ua/ua/x/17pro-esim/'] },
    prom: { enabled: true, queries: ['iphone 17 pro 256gb'], pages: 1 },
    filter: { models: ['iphone 17 pro 256gb'], condition: 'new' },
    deals: { maxDiscount: 0.3 },
  });
  const hl = (name: string, low: number) =>
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'AggregateOffer', lowPrice: low, highPrice: low + 10000, offerCount: 50, availability: 'https://schema.org/InStock' } })}</script>`;
  const promLd = (name: string, price: number, id: number) =>
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, url: `https://prom.ua/ua/m${id}-x.html`, offers: { '@type': 'Offer', price: String(price), availability: 'http://schema.org/InStock', seller: { name: `shop${id}` } } })}</script>`;

  let silverLow = 54000;
  let promItems: Array<[string, number, number]> = [];
  let olxItems: ReturnType<typeof olxRaw>[] = [];
  const { fetch } = mockFetch((url) => {
    if (url.includes('17pro-silver')) return hl('Apple iPhone 17 Pro 256GB Silver (MG8G4)', silverLow);
    if (url.includes('17pro-esim')) return hl('Apple iPhone 17 Pro 256GB eSIM Silver (MG7K4)', 49900);
    if (url.includes('prom.ua')) return promItems.map(([n, p, id]) => promLd(n, p, id)).join('');
    return { data: olxItems };
  });

  const state = emptyState();
  const sent: string[] = [];
  const notify = async (m: string[]) => void sent.push(...m);
  const H = 3_600_000;

  // 3 спокійні запуски: накопичуємо історію найкращої ціни (перший — прогрів)
  promItems = [
    ['Смартфон iPhone 17 Pro 256GB Silver', 61999, 1],
    ['Смартфон Apple iPhone 17 Pro 256GB Deep Blue (MG8J4) Б/У [180815]', 40000, 2], // вживаний — ігнор
    ['Мобільний телефон Apple iPhone 17 Pro Max 256GB Deep Blue', 30000, 3], // інша модель — ігнор
  ];
  olxItems = [olxRaw('iPhone 17 Pro 256 новий запакований', 55000, { state: 'new', id: 9001 })];
  for (let i = 0; i < 3; i++) await run({ cfg: cfg17, state, now: NOW + i * 7 * H, fetch, notify, log: silent });
  assert.equal(sent.length, 0);
  assert.deepEqual(Object.keys(state.best).sort(), ['iphone 17 pro 256gb', 'iphone 17 pro 256gb esim']);

  // OLX: "новий", але АКБ 97% → вживаний, не в фільтрі; Prom: на 6% дешевше за Hotline-мінімум → угода
  olxItems = [olxRaw('iPhone 17 Pro 256 новий, АКБ 97%', 40000, { state: 'new', id: 9002 })];
  promItems = [['Смартфон Apple iPhone 17 Pro 256GB Silver (MG8G4)', 50700, 4]];
  let r = await run({ cfg: cfg17, state, now: NOW + 30 * H, fetch, notify, log: silent });
  assert.equal(r.sent, 2); // 🔥 Prom vs Hotline і 🏆 нова найкраща ціна (50 700 < 54 000 на 6%)
  const text = sent.join('\n');
  assert.match(text, /🔥 <b>iphone 17 pro 256gb \(нове\)<\/b>/);
  assert.match(text, /найдешевший магазин на Hotline 54\s000 ₴, −6%/);
  assert.match(text, /🏆 <b>iphone 17 pro 256gb \(нове\)<\/b>/);
  assert.doesNotMatch(text, /eSIM \(нове\)/); // eSIM-версія без змін

  // наступний запуск з тією ж ціною — тиша
  sent.length = 0;
  r = await run({ cfg: cfg17, state, now: NOW + 31 * H, fetch, notify, log: silent });
  assert.equal(r.sent, 0);

  // Hotline-мінімум сам упав на 5% — 🏆 лише один раз, без дубля 📉
  promItems = [];
  silverLow = 48000;
  r = await run({ cfg: cfg17, state, now: NOW + 40 * H, fetch, notify, log: silent });
  assert.equal(r.sent, 1);
  assert.match(sent.join('\n'), /🏆 .*\n<b>48\s000 ₴<\/b> \(мін\. за 30 днів 50\s700 ₴, −5%\)/);
});

test('ignoreEsim: SIM і eSIM — один ринок, орієнтир і найкраща ціна спільні', async () => {
  const cfg = testConfig({
    olx: { enabled: false },
    hotline: { enabled: true, urls: ['https://hotline.ua/ua/x/sim/', 'https://hotline.ua/ua/x/esim/'] },
    prom: { enabled: true, queries: ['iphone 17 pro 256gb'], pages: 1 },
    filter: { models: ['iphone 17 pro 256gb'], condition: 'new', ignoreEsim: true },
    deals: { maxDiscount: 0.3 },
  });
  const hl = (name: string, low: number) =>
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'AggregateOffer', lowPrice: low, offerCount: 50 } })}</script>`;
  let esimLow = 49900;
  let promPrice = 52000;
  const { fetch } = mockFetch((url) => {
    if (url.includes('/x/sim/')) return hl('Apple iPhone 17 Pro 256GB Silver (MG8G4)', 54000);
    if (url.includes('/x/esim/')) return hl('Apple iPhone 17 Pro 256GB eSIM Silver (MG7K4)', esimLow);
    return `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Смартфон iPhone 17 Pro 256GB Silver', url: 'https://prom.ua/ua/m77-x.html', offers: { price: String(promPrice), availability: 'http://schema.org/InStock' } })}</script>`;
  });
  const state = emptyState();
  const sent: string[] = [];
  const H = 3_600_000;
  for (let i = 0; i < 4; i++) await run({ cfg, state, now: NOW + i * 7 * H, fetch, notify: async (m) => void sent.push(...m), log: silent });

  // Prom 52 000 з фіз. SIM на 4% дешевший за SIM-магазини (54 000), але дорожчий за eSIM (49 900) → не угода
  assert.equal(sent.length, 0);
  assert.deepEqual(Object.keys(state.best), ['iphone 17 pro 256gb']);
  assert.equal(state.best['iphone 17 pro 256gb']!.at(-1)!.low, 49900);

  // eSIM подешевшав до 48 500 → 🏆, у повідомленні видно, що це eSIM
  esimLow = 48500;
  await run({ cfg, state, now: NOW + 40 * H, fetch, notify: async (m) => void sent.push(...m), log: silent });
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /🏆 <b>iphone 17 pro 256gb eSIM \(нове\)<\/b>\n<b>48\s500 ₴<\/b> \(мін\. за 30 днів 49\s900 ₴, −3%\)/);

  // Prom 46 000 (−5,2% від спільного мінімуму 48 500) → 🔥 і 🏆
  sent.length = 0;
  promPrice = 46000;
  const r = await run({ cfg, state, now: NOW + 47 * H, fetch, notify: async (m) => void sent.push(...m), log: silent });
  assert.equal(r.sent, 2);
  assert.match(sent.join('\n'), /найдешевший магазин на Hotline 48\s500 ₴, −5%/);
});
