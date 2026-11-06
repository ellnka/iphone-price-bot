import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildMessages, escapeHtml, formatDeal, sendMessage } from '../src/telegram.ts';
import type { Deal } from '../src/types.ts';
import { mockFetch } from './helpers.ts';

const deal: Deal = {
  kind: 'market',
  source: 'olx',
  id: '1',
  modelKey: 'iphone 15 pro 256gb (вживане)',
  title: 'iPhone 15 Pro 256 <ідеал> & Neverlock',
  price: 25500,
  url: 'https://www.olx.ua/d/uk/obyavlenie/x-ID1.html?a=1&b=2',
  reference: 30000,
  discount: 0.15,
  previousPrice: 27000,
  city: 'Київ',
  details: 'стан: як новий · АКБ 85–89%',
};

test('escapeHtml', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('formatDeal: ціна, медіана, знижка, екранування', () => {
  const s = formatDeal(deal);
  assert.match(s, /^🔥 <b>iphone 15 pro 256gb \(вживане\)<\/b>/);
  assert.match(s, /25\s500 ₴/);
  assert.match(s, /медіана 30\s000 ₴, −15%/);
  assert.match(s, /знизив з 27\s000 ₴/);
  assert.match(s, /стан: як новий · АКБ 85–89%/);
  assert.match(s, /&lt;ідеал&gt; &amp; Neverlock/);
  assert.match(s, /href="https:\/\/www\.olx\.ua\/d\/uk\/obyavlenie\/x-ID1\.html\?a=1&amp;b=2"/);
  assert.match(s, /olx, Київ$/);
});

test('buildMessages: ділить на частини < 4096', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...deal, id: String(i), title: 'x'.repeat(80) }));
  const msgs = buildMessages(many);
  assert.ok(msgs.length > 1);
  for (const m of msgs) assert.ok(m.length <= 4000, `довжина ${m.length}`);
  assert.equal(msgs.join('\n\n').split('🔥').length - 1, 40);
});

test('sendMessage: тіло запиту та повтор при 429', async () => {
  let first = true;
  const { fetch, calls } = mockFetch(() => {
    if (first) {
      first = false;
      return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 0 } }), { status: 429 });
    }
    return { ok: true };
  });
  await sendMessage('TOKEN', '42', 'hi', fetch);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, 'https://api.telegram.org/botTOKEN/sendMessage');
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.chat_id, '42');
  assert.equal(body.parse_mode, 'HTML');
});

test('sendMessage: помилка (напр., неправильний CHAT_ID) пробивається', async () => {
  const { fetch } = mockFetch(() => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 }));
  await assert.rejects(sendMessage('T', '1', 'x', fetch), /chat not found/);
});
