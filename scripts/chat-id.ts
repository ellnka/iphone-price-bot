/**
 * Допомагає дізнатися CHAT_ID.
 * 1) Напиши своєму боту будь-що (або додай його в групу й напиши там).
 * 2) BOT_TOKEN=123:abc node scripts/chat-id.ts
 */
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Вкажи BOT_TOKEN: BOT_TOKEN=123:abc node scripts/chat-id.ts');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = (await res.json()) as {
  ok: boolean;
  description?: string;
  result?: Array<{ message?: { chat: { id: number; type: string; title?: string; username?: string; first_name?: string } } }>;
};
if (!body.ok) {
  console.error(`Telegram: ${body.description}`);
  process.exit(1);
}

const chats = new Map<number, string>();
for (const u of body.result ?? []) {
  const c = u.message?.chat;
  if (c) chats.set(c.id, `${c.type}: ${c.title ?? c.username ?? c.first_name ?? ''}`);
}
if (!chats.size) console.log('Порожньо. Напиши боту повідомлення і запусти ще раз.');
for (const [id, name] of chats) console.log(`CHAT_ID=${id}   (${name})`);
