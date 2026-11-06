import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeEntities, fetchHotline, parseHotline } from '../src/sources/hotline.ts';
import { mockFetch, testConfig } from './helpers.ts';

const URL1 = 'https://hotline.ua/ua/mobile-mobilnye-telefony-i-smartfony/apple-iphone-15-128gb-black-mtp03/';

// Розмітка, близька до реальної: ціна розбита по тегах, пробіли — &nbsp; / вузькі
const HTML_TEXT = `<html><head><title>Apple iPhone 15 128GB Black (MTP03) купити в інтернет-магазині: ціни на смартфон</title></head>
<body><h1 class="title__main">Apple iPhone 15 128GB Black (MTP03)</h1>
<div class="price"><span>ціни:</span> <span>21&nbsp;986</span> &ndash; <span>47 499</span> <span>₴</span></div>
<div>Всього пропозицій: 68</div>
<section class="new"><span>від 74 720 ₴</span></section></body></html>`;

const HTML_LD = `<html><head><title>x</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Apple iPhone 16 Pro 256GB Desert Titanium",
"offers":{"@type":"AggregateOffer","lowPrice":"47999","highPrice":"59999","offerCount":"41","priceCurrency":"UAH"}}</script>
</head><body><h1>Інша назва</h1></body></html>`;

test('decodeEntities', () => {
  // &#160; лишається справжнім nbsp — його нормалізує htmlToText
  assert.equal(decodeEntities('21&nbsp;986 &ndash; 47&#160;499 &amp; &#x20B4;'), '21 986 – 47 499 & ₴');
});

test('parseHotline: діапазон цін з тексту', () => {
  const p = parseHotline(HTML_TEXT, URL1)!;
  assert.equal(p.lowPrice, 21986);
  assert.equal(p.highPrice, 47499);
  assert.equal(p.offerCount, 68);
  assert.equal(p.title, 'Apple iPhone 15 128GB Black (MTP03)');
});

test('parseHotline: JSON-LD має пріоритет', () => {
  const p = parseHotline(HTML_LD, URL1)!;
  assert.equal(p.lowPrice, 47999);
  assert.equal(p.highPrice, 59999);
  assert.equal(p.offerCount, 41);
  assert.equal(p.title, 'Apple iPhone 16 Pro 256GB Desert Titanium');
});

test('parseHotline: без ціни → null', () => {
  assert.equal(parseHotline('<html><h1>Немає в наявності</h1></html>', URL1), null);
});

test('fetchHotline: одна сторінка зламалась — решта працює; всі зламались — помилка', async () => {
  const urls = [URL1, 'https://hotline.ua/ua/x/broken/'];
  const { fetch } = mockFetch((url) => (url === URL1 ? HTML_TEXT : '<html>капча</html>'));
  const logs: string[] = [];
  const pts = await fetchHotline(testConfig({ hotline: { urls } }), fetch, (m) => logs.push(m));
  assert.equal(pts.length, 1);
  assert.match(logs.join('\n'), /не вдалося знайти ціну/);

  const bad = mockFetch(() => new Response('', { status: 403 }));
  await assert.rejects(fetchHotline(testConfig({ hotline: { urls } }), bad.fetch, () => {}), /жодної ціни/);
});

// Фрагменти реальної сторінки hotline.ua (листопад 2026): JSON-LD з числами + розмітка ціни у Vue-компоненті
const REAL_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Apple iPhone 15 128GB Black (MTP03)","offers":{"@type":"AggregateOffer","lowPrice":21986,"highPrice":47499,"priceCurrency":"UAH","offerCount":68,"availability":"https://schema.org/InStock"}}</script>`;
const REAL_MARKUP = `<title>Apple iPhone 15 128GB Black (MTP03) купити в інтернет-магазині: ціни на смартфон iPhone 15</title>
<h1 class="title__main">Смартфон Apple iPhone 15 128GB Black (MTP03)</h1>
<div class="many__price" data-v-b51ef06e><span class="many__price-title" data-v-b51ef06e>
            ціни:
          </span> <span data-tracking-id="product-6" class="many__price-sum text-orange" data-v-b51ef06e><span data-tracking-id="" class="_1UA1u5dm_Tf_Bhl7TkXl" data-v-b51ef06e><span style="font-size:24px;">21 986</span><!----> <!----></span> <span class="many__price-separator text-xx-lg" data-v-b51ef06e>–</span> <span class="many__price-sum"><span style="font-size:24px;">47 499</span></span> <span>₴</span></span></div>`;

test('реальна сторінка Hotline: JSON-LD', () => {
  const p = parseHotline(`<html><head>${REAL_LD}</head><body>${REAL_MARKUP}</body></html>`, URL1)!;
  assert.deepEqual([p.lowPrice, p.highPrice, p.offerCount, p.title], [21986, 47499, 68, 'Apple iPhone 15 128GB Black (MTP03)']);
});

test('реальна сторінка Hotline: запасний розбір розмітки, якщо JSON-LD зникне', () => {
  const p = parseHotline(`<html><body>${REAL_MARKUP}</body></html>`, URL1)!;
  assert.equal(p.lowPrice, 21986);
  assert.equal(p.highPrice, 47499);
  assert.equal(p.title, 'Смартфон Apple iPhone 15 128GB Black (MTP03)');
});
