import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildUrl, fetchOlx, mapOlxOffer, type OlxOffer } from '../src/sources/olx.ts';
import { fixture, mockFetch, olxRaw, testConfig } from './helpers.ts';

const page = JSON.parse(fixture('olx-page.json')) as { data: OlxOffer[] };

test('mapOlxOffer: структура з живої відповіді OLX', () => {
  const o = mapOlxOffer(page.data[0]!)!;
  assert.equal(o.id, '939996702');
  assert.equal(o.price, 32500);
  assert.equal(o.condition, 'used');
  assert.equal(o.city, 'Київ');
  assert.equal(o.sellerId, '29810783');
  assert.equal(o.previousPrice, undefined);
});

test('mapOlxOffer: попередня ціна, USD→UAH, договірна', () => {
  assert.equal(mapOlxOffer(page.data[1]!)!.previousPrice, 36000);
  const usd = mapOlxOffer(page.data[3]!)!;
  assert.equal(usd.price, 33200);
  assert.equal(usd.condition, 'new');
  assert.equal(mapOlxOffer(page.data[4]!), null); // "договірна" без ціни
});

test('buildUrl', () => {
  const u = new URL(buildUrl('iphone 15', 50, 50, 85));
  assert.equal(u.origin + u.pathname, 'https://www.olx.ua/api/v1/offers/');
  assert.equal(u.searchParams.get('query'), 'iphone 15');
  assert.equal(u.searchParams.get('offset'), '50');
  assert.equal(u.searchParams.get('category_id'), '85');
  assert.equal(u.searchParams.get('currency'), 'UAH');
});

test('fetchOlx: фільтри категорії, мін. ціни, бізнесу; дедуп між запитами', async () => {
  const { fetch, calls } = mockFetch(() => page);
  const cfg = testConfig({ olx: { queries: ['iphone 16', 'iphone 16 pro'], pages: 1, skipBusiness: true } });
  const offers = await fetchOlx(cfg, fetch, () => {});
  assert.equal(calls.length, 2);
  // скло (категорія 3279, 300 грн) і бізнес-оголошення відсіяні; договірна без ціни теж
  assert.deepEqual(offers.map((o) => o.id).sort(), ['939000001', '939996702']);
});

test('fetchOlx: пагінація зупиняється на неповній сторінці', async () => {
  const full = Array.from({ length: 3 }, (_, i) => olxRaw(`iPhone 15 128 #${i}`, 20000 + i));
  const { fetch, calls } = mockFetch((url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return { data: offset === 0 ? full : [olxRaw('iPhone 15 128 last', 21000)], links: { next: { href: 'x' } } };
  });
  const cfg = testConfig({ olx: { queries: ['iphone 15'], pages: 5, pageSize: 3 } });
  const offers = await fetchOlx(cfg, fetch, () => {});
  assert.equal(calls.length, 2);
  assert.equal(offers.length, 4);
});

test('fetchOlx: якщо категорія дала 0 — повтор без неї', async () => {
  const { fetch, calls } = mockFetch((url) =>
    new URL(url).searchParams.has('category_id') ? { data: [] } : { data: [olxRaw('iPhone 15 128', 20000)] },
  );
  const logs: string[] = [];
  const cfg = testConfig({ olx: { queries: ['iphone 15'], pages: 1 } });
  const offers = await fetchOlx(cfg, fetch, (m) => logs.push(m));
  assert.equal(calls.length, 2);
  assert.equal(offers.length, 1);
  assert.match(logs[0]!, /без категорії/);
});

test('fetchOlx: 403 пробивається як помилка (без повторів)', async () => {
  const { fetch, calls } = mockFetch(() => new Response('forbidden', { status: 403 }));
  const cfg = testConfig({ olx: { queries: ['iphone 15'], pages: 1 } });
  await assert.rejects(fetchOlx(cfg, fetch, () => {}), /HTTP 403/);
  assert.equal(calls.length, 1);
});

test('живий формат params: storage, condition_grade, battery_health; дефекти відсіюються', async () => {
  const raw = (id: number, title: string, grade?: string) => ({
    id, url: `https://www.olx.ua/x-ID${id}.html`, title, category: { id: 85 }, business: false, user: { id },
    params: [
      { key: 'price', value: { value: 23000, currency: 'UAH', converted_value: null, previous_value: null } },
      { key: 'state', value: { key: 'used', label: 'Вживане' } },
      { key: 'storage', value: { key: '128gb', label: '128 ГБ' } },
      ...(grade ? [{ key: 'condition_grade', value: { key: grade } }] : []),
      { key: 'battery_health', value: { key: '85_89', label: '85–89%' } },
    ],
  });
  const o = mapOlxOffer(raw(1, 'Iphone 15 pro 128 Natural Titanium', 'like_new'))!;
  assert.equal(o.storage, '128gb');
  assert.equal(o.grade, 'як новий');
  assert.equal(o.battery, '85–89%');

  const { fetch } = mockFetch(() => ({ data: [raw(1, 'iPhone 15 Pro', 'very_good'), raw(2, 'IPhone 15pro 128gb. Читайте опис!', 'defects')] }));
  const offers = await fetchOlx(testConfig({ olx: { queries: ['iphone 15'], pages: 1 } }), fetch, () => {});
  assert.deepEqual(offers.map((x) => x.id), ['1']);
  const keep = await fetchOlx(testConfig({ olx: { queries: ['iphone 15'], pages: 1, skipDefects: false } }), fetch, () => {});
  assert.equal(keep.length, 2);
});
