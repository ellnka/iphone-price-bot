import type { Deal } from './types.ts';
import { sleep, type FetchLike } from './http.ts';

const fmt = new Intl.NumberFormat('uk-UA');
const uah = (n: number) => `${fmt.format(n)} ₴`;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON: Record<Deal['kind'], string> = { market: '🔥', watch: '🎯', 'new-low': '📉', best: '🏆' };

export function formatDeal(d: Deal): string {
  const lines = [`${ICON[d.kind]} <b>${escapeHtml(d.modelKey)}</b>`];

  let price = `<b>${uah(d.price)}</b>`;
  if (d.reference && d.discount !== undefined) {
    const label = d.referenceLabel ?? (d.kind === 'new-low' ? 'було' : 'медіана');
    price += ` (${label} ${uah(d.reference)}, −${Math.round(d.discount * 100)}%)`;
  }
  lines.push(price);

  if (d.previousPrice) lines.push(`↘︎ продавець знизив з ${uah(d.previousPrice)}`);
  if (d.details) lines.push(escapeHtml(d.details));
  if (d.note) lines.push(escapeHtml(d.note));
  const where = [d.source, d.seller, d.city].filter(Boolean).join(', ');
  lines.push(`<a href="${escapeHtml(d.url)}">${escapeHtml(d.title.slice(0, 80))}</a> · ${escapeHtml(where)}`);
  return lines.join('\n');
}

/** Розбиває на повідомлення до ~4000 символів (ліміт Telegram — 4096). */
export function buildMessages(deals: Deal[], limit = 4000): string[] {
  const parts = deals.map(formatDeal);
  const msgs: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 2 > limit) {
      msgs.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) msgs.push(cur);
  return msgs;
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
    if (res.status === 429) {
      await sleep(((body.parameters?.retry_after ?? 5) + 1) * 1000);
      continue;
    }
    throw new Error(`Telegram ${res.status}: ${body.description ?? 'unknown error'}`);
  }
  throw new Error('Telegram: забагато повторів (429)');
}
