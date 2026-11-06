/**
 * Розбір schema.org Product з <script type="application/ld+json">.
 * Цей формат віддають більшість магазинів і агрегаторів (Hotline, Prom, ...),
 * бо його читає Google — тому він стабільніший за верстку.
 */

export interface LdProduct {
  name: string;
  url?: string;
  price?: number; // Offer.price
  lowPrice?: number; // AggregateOffer.lowPrice
  highPrice?: number;
  offerCount?: number;
  availability?: string; // "InStock" | "OutOfStock" | "PreOrder" ...
  seller?: string;
  sku?: string;
}

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function extractProducts(html: string): LdProduct[] {
  const out: LdProduct[] = [];
  for (const [, body] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(body!.trim());
    } catch {
      continue;
    }
    const roots = Array.isArray(data) ? data : [data];
    const nodes = roots.flatMap((n) =>
      n && typeof n === 'object' && '@graph' in n ? ((n as { '@graph': unknown[] })['@graph'] ?? []) : [n],
    ) as Array<Record<string, unknown>>;

    for (const n of nodes) {
      if (!n || n['@type'] !== 'Product' || typeof n.name !== 'string') continue;
      const offers = (Array.isArray(n.offers) ? n.offers[0] : n.offers) as Record<string, unknown> | undefined;
      const seller = offers?.seller as { name?: string } | undefined;
      out.push({
        name: decode(n.name).trim(),
        url: typeof n.url === 'string' ? n.url : typeof offers?.url === 'string' ? offers.url : undefined,
        price: num(offers?.price),
        lowPrice: num(offers?.lowPrice),
        highPrice: num(offers?.highPrice),
        offerCount: num(offers?.offerCount),
        availability: typeof offers?.availability === 'string' ? offers.availability.split('/').pop() : undefined,
        seller: seller?.name ? decode(seller.name).trim() : undefined,
        sku: typeof n.sku === 'string' ? n.sku : undefined,
      });
    }
  }
  return out;
}
