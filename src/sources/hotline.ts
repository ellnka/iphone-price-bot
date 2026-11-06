import type { Config, PricePoint } from '../types.ts';
import { errorMessage, getText, sleep, type FetchLike } from '../http.ts';
import { extractProducts } from './jsonld.ts';

/**
 * Hotline.ua — агрегатор цін. Для кожної сторінки товару зі списку в config.json
 * беремо мінімальну ціну по магазинах.
 *
 * Стратегії розбору (по черзі, перша успішна перемагає):
 *  1. JSON-LD (schema.org AggregateOffer / Offer)
 *  2. Текст у шапці товару: "ціни: 21 986 – 47 499 ₴"
 *
 * Перевірено наживо (листопад 2026): Product + AggregateOffer {lowPrice, highPrice, offerCount}.
 * Увага: мінімум Hotline може включати відновлені (refurbished) пропозиції.
 */

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  thinsp: ' ',
  ndash: '–',
  mdash: '—',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  hellip: '…',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

const toInt = (s: string) => Number(s.replace(/[^\d]/g, ''));

function fromJsonLd(html: string): Partial<PricePoint> | null {
  const p = extractProducts(html).find((x) => x.lowPrice ?? x.price);
  if (!p) return null;
  if (p.availability === 'OutOfStock' || p.availability === 'Discontinued') return null;
  return {
    title: p.name,
    lowPrice: Math.round((p.lowPrice ?? p.price)!),
    highPrice: p.highPrice ? Math.round(p.highPrice) : undefined,
    offerCount: p.offerCount,
  };
}

function fromText(text: string): Partial<PricePoint> | null {
  const NUM = '(\\d{1,3}(?: \\d{3})+|\\d{4,7})';
  const range = text.match(new RegExp(`(?:ціни|цены)\\s*:?\\s*${NUM}\\s*[–—-]\\s*${NUM}\\s*(?:₴|грн)`, 'i'));
  if (range) return { lowPrice: toInt(range[1]!), highPrice: toInt(range[2]!) };
  const single = text.match(new RegExp(`(?:ціна|цена)\\s*:?\\s*${NUM}\\s*(?:₴|грн)`, 'i'));
  if (single) return { lowPrice: toInt(single[1]!) };
  return null;
}

function title(html: string): string | undefined {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return htmlToText(h1).trim();
  const t = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  return t ? decodeEntities(t).split(/\s+купити|\s+купить|\s+[-–|]\s+/i)[0]!.trim() : undefined;
}

export function parseHotline(html: string, url: string): PricePoint | null {
  const text = htmlToText(html);
  const p = fromJsonLd(html) ?? fromText(text);
  if (!p?.lowPrice) return null;
  const count = text.match(/(?:Всього пропозицій|Всего предложений)\s*:?\s*(\d+)/i);
  return {
    source: 'hotline',
    url,
    title: p.title ?? title(html) ?? url,
    lowPrice: p.lowPrice,
    highPrice: p.highPrice,
    offerCount: p.offerCount ?? (count ? Number(count[1]) : undefined),
  };
}

export async function fetchHotline(cfg: Config, fetchImpl?: FetchLike, log = console.log): Promise<PricePoint[]> {
  const out: PricePoint[] = [];
  for (const url of cfg.hotline.urls) {
    try {
      const html = await getText(url, { fetch: fetchImpl });
      const p = parseHotline(html, url);
      if (p) out.push(p);
      else log(`[hotline] не вдалося знайти ціну на ${url} — можливо, змінилась верстка`);
    } catch (e) {
      log(`[hotline] ${url}: ${errorMessage(e)}`);
    }
    await sleep(cfg.requestDelayMs);
  }
  if (cfg.hotline.urls.length > 0 && out.length === 0) {
    throw new Error('Hotline: жодної ціни не отримано');
  }
  return out;
}
