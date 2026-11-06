/**
 * Перевірка джерел без збереження стану і без Telegram:
 *   node scripts/probe.ts                 — усі увімкнені джерела з config.json
 *   node scripts/probe.ts olx|rozetka|prom|hotline
 * Показує, що розпізналось і чи проходить фільтр (filter.models / filter.condition).
 */
import { loadConfig, readEnv } from '../src/config.ts';
import { fetchOlx } from '../src/sources/olx.ts';
import { fetchRozetka } from '../src/sources/rozetka.ts';
import { fetchProm } from '../src/sources/prom.ts';
import { fetchHotline } from '../src/sources/hotline.ts';
import { looksUsed, normalizeTitle } from '../src/normalize.ts';
import type { Offer } from '../src/types.ts';

const only = process.argv[2];
const cfg = loadConfig(readEnv().configPath);
const want = (name: string, enabled: boolean) => (only ? only === name : enabled);

function show(name: string, offers: Offer[]) {
  let ok = 0;
  for (const o of offers.sort((a, b) => a.price - b.price)) {
    const info = normalizeTitle(o.title, o.storage);
    const cond = o.condition === 'new' && looksUsed(o.title) ? 'used' : o.condition;
    const inFilter =
      !!info &&
      (!cfg.filter.models.length || cfg.filter.models.includes(info.base)) &&
      (!cfg.filter.condition || cfg.filter.condition === cond);
    if (inFilter) ok++;
    console.log(
      `${inFilter ? '✓' : info ? '·' : '✗'} ${String(o.price).padStart(7)} ₴  ${cond.padEnd(4)}  ${(info?.key ?? '—').padEnd(28)} ⟵ ${o.title.slice(0, 90)}${o.seller ? `  [${o.seller}]` : ''}`,
    );
  }
  console.log(`\n${name}: ${offers.length} пропозицій, у фільтрі ${ok}   (✓ у фільтрі · розпізнано, але не цікавить ✗ не розпізнано)\n`);
}

if (want('olx', cfg.olx.enabled)) show('OLX', await fetchOlx({ ...cfg, olx: { ...cfg.olx, pages: 1 } }));
if (want('rozetka', cfg.rozetka.enabled)) show('Rozetka', await fetchRozetka(cfg));
if (want('prom', cfg.prom.enabled)) show('Prom', await fetchProm(cfg));
if (want('hotline', cfg.hotline.enabled) && cfg.hotline.urls.length) {
  const points = await fetchHotline(cfg);
  for (const p of points) {
    console.log(`${String(p.lowPrice).padStart(7)} ₴  ${(normalizeTitle(p.title)?.key ?? '—').padEnd(28)} ⟵ ${p.title} (${p.offerCount ?? '?'} пропозицій)`);
  }
  console.log(`\nHotline: ${points.length}/${cfg.hotline.urls.length} сторінок з ціною`);
}
