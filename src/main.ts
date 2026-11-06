/**
 * Запуск:
 *   node src/main.ts            — один прохід (для cron / GitHub Actions)
 *   node src/main.ts --loop 30  — постійно, кожні 30 хв (VPS, домашній ПК)
 *   DRY_RUN=1 node src/main.ts  — нічого не надсилати, лише вивести в консоль
 */
import { loadConfig, readEnv } from './config.ts';
import { loadState, saveState } from './store.ts';
import { run } from './run.ts';
import { sendMessage } from './telegram.ts';
import { sleep } from './http.ts';

const env = readEnv();

async function once(): Promise<boolean> {
  const cfg = loadConfig(env.configPath);
  const state = loadState(env.statePath);

  if (!env.dryRun && (!env.botToken || !env.chatId)) {
    throw new Error('Потрібні BOT_TOKEN і CHAT_ID (або DRY_RUN=1 для перевірки без Telegram)');
  }

  const notify = async (messages: string[]) => {
    for (const m of messages) {
      if (env.dryRun) console.log(`\n----- повідомлення -----\n${m}\n------------------------`);
      else await sendMessage(env.botToken!, env.chatId!, m);
    }
  };

  try {
    const r = await run({ cfg, state, now: Date.now(), notify, dryRun: env.dryRun });
    console.log(`[run] ${JSON.stringify(r)}`);
    const enabled =
      Number(cfg.olx.enabled) +
      Number(cfg.hotline.enabled && cfg.hotline.urls.length > 0) +
      Number(cfg.rozetka.enabled && cfg.rozetka.queries.length > 0) +
      Number(cfg.prom.enabled && cfg.prom.queries.length > 0);
    return r.failedSources.length < enabled; // false, якщо впали всі джерела
  } finally {
    saveState(env.statePath, state); // зберігаємо навіть при помилці надсилання
  }
}

const loopIdx = process.argv.indexOf('--loop');
if (loopIdx !== -1) {
  const minutes = Number(process.argv[loopIdx + 1] ?? 30);
  for (;;) {
    try {
      await once();
    } catch (e) {
      console.error(e);
    }
    await sleep(minutes * 60_000);
  }
} else {
  try {
    const ok = await once();
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
