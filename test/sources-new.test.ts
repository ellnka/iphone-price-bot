import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePromSearch, buildPromUrl, fetchProm } from '../src/sources/prom.ts';
import { mapRozetka, fetchRozetka } from '../src/sources/rozetka.ts';
import { extractProducts } from '../src/sources/jsonld.ts';
import { mockFetch, testConfig } from './helpers.ts';

// Структура зі сторінки пошуку prom.ua (листопад 2026): по одному Product на товар
const ld = (name: string, price: string, seller: string, url: string, availability = 'InStock') =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name,
    url,
    brand: { '@type': 'Brand', name: 'Apple' },
    offers: { '@type': 'Offer', url, availability: `http://schema.org/${availability}`, price, priceCurrency: 'UAH', seller: { '@type': 'Organization', name: seller } },
  })}</script>`;

const PROM_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
${ld('MDM ПРОФІЛЬ !!!Смартфон Apple iPhone 17 Pro 256GB Silver (MG8G4) НОВИЙ!!!', '44997', 'everydays', 'https://prom.ua/ua/m-111-a.html')}
${ld('Смартфон Apple iPhone 17 Pro 256GB Deep Blue (MG8J4) Б/У [180815]', '48199', '«Touch» - інтернет-магазин', 'https://prom.ua/ua/m222-b.html')}
${ld('Смартфон Apple iPhone 17 Pro 256GB Silver (MG8G4) Б/У [182691]', '49699', 'Touch', 'https://prom.ua/ua/m333-c.html', 'PreOrder')}
${ld('Смартфон iPhone 17 Pro 256GB Silver', '61999', '🛒 Економія ❤️', 'https://prom.ua/ua/m-2830928199945905395-smartfon-iphone-pro.html')}
${ld('Смартфон Apple iPhone 17 Pro 256GB eSim Silver', '61236', 'ZOOM - МАРКЕТ', 'https://prom.ua/ua/m5189968817004665170-smartfon-apple-iphone.html')}
${ld('Мобільний телефон Apple iPhone 17 Pro Max 256GB Deep Blue (MFYP4)', '74917', 'Інтернет-магазин &quot;Домовичок&quot;', 'https://prom.ua/ua/m-438-d.html')}
</head></html>`;

test('extractProducts: сутності в імені продавця, ціни-рядки, AggregateOffer', () => {
  const ps = extractProducts(PROM_PAGE);
  assert.equal(ps.length, 6);
  assert.equal(ps[5]!.seller, 'Інтернет-магазин "Домовичок"');
  assert.equal(ps[3]!.price, 61999);
  assert.equal(ps[2]!.availability, 'PreOrder');
});

test('Prom: стан за заголовком, лише в наявності, id з URL', () => {
  const offers = parsePromSearch(PROM_PAGE);
  assert.equal(offers.length, 5); // PreOrder відкинуто
  const byId = Object.fromEntries(offers.map((o) => [o.id, o]));
  assert.equal(byId['m222']!.condition, 'used');
  assert.equal(byId['m-2830928199945905395']!.condition, 'new');
  assert.equal(byId['m-2830928199945905395']!.seller, '🛒 Економія ❤️');
  assert.equal(buildPromUrl('iphone 17 pro 256gb', 2), 'https://prom.ua/ua/search?search_term=iphone+17+pro+256gb&sort=price&page=2');
});

test('fetchProm: сторінки, зупинка на порожній', async () => {
  const { fetch, calls } = mockFetch((url) => (url.includes('page=2') ? '<html></html>' : PROM_PAGE));
  const cfg = testConfig({ prom: { enabled: true, queries: ['iphone 17 pro 256gb'], pages: 3 } });
  const offers = await fetchProm(cfg, fetch, () => {});
  assert.equal(calls.length, 2);
  assert.equal(offers.length, 5);
});

// Структура common-api.rozetka.com.ua (листопад 2026)
const RZ = [
  { id: 543544870, title: 'Мобільний телефон Apple iPhone 17 Pro 256GB Silver (MG8G4AF/A)', href: 'https://rozetka.com.ua/ua/543544870/p543544870/', price: 64999, old_price: 66999, sell_status: 'available', state: 'new', seller_id: 5 },
  { id: 628013516, title: 'Смартфон Apple iPhone 17 Pro 256 GB Cosmic Orange (Grade B) - Б/В', href: 'https://rozetka.com.ua/ua/628013516/p628013516/', price: 58915, old_price: 65599, sell_status: 'available', state: 'used', seller_id: 81383 },
  { id: 600412717, title: 'Мобільний телефон Apple iPhone 14 256GB (PRODUCT)RED (REF B)', href: 'https://rozetka.com.ua/ua/p600412717/', price: 24299, old_price: 0, sell_status: 'unavailable', state: 'refurbished', seller_id: 5 },
];

test('mapRozetka: стан, наявність, продавець, стара ціна', () => {
  const a = mapRozetka(RZ[0]!)!;
  assert.deepEqual([a.condition, a.seller, a.previousPrice, a.price], ['new', 'Rozetka', 66999, 64999]);
  assert.equal(mapRozetka(RZ[1]!)!.condition, 'used');
  assert.equal(mapRozetka(RZ[2]!), null); // немає в наявності
});

test('fetchRozetka: пошук з перенаправленням у категорію → деталі', async () => {
  const { fetch, calls } = mockFetch((url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/catalog/search')) {
      return u.searchParams.has('section_id')
        ? { data: { goods: RZ.map((g) => ({ id: g.id })) } }
        : { data: { meta: { navigateTo: { query: { page: '1', text: 'apple iphone 17 pro 256gb', section_id: '80003', redirected: '1' } } } } };
    }
    assert.equal(u.searchParams.get('ids'), RZ.map((g) => g.id).join(','));
    return { data: RZ };
  });
  const cfg = testConfig({ rozetka: { enabled: true, queries: ['apple iphone 17 pro 256gb'] } });
  const offers = await fetchRozetka(cfg, fetch, () => {});
  assert.equal(calls.length, 3);
  assert.deepEqual(offers.map((o) => o.id).sort(), ['543544870', '628013516']);
});
