import { readFileSync } from 'node:fs';
import type { Config } from './types.ts';

export const DEFAULTS: Config = {
  olx: {
    enabled: true,
    queries: ['iphone 14', 'iphone 15', 'iphone 16', 'iphone 17'],
    categoryId: 85, // "Мобільні телефони та смартфони"
    pages: 2,
    pageSize: 50,
    minPrice: 5000,
    skipBusiness: false,
    skipDefects: true,
  },
  hotline: { enabled: true, urls: [], minDrop: 0.03 },
  rozetka: { enabled: false, queries: [] },
  prom: { enabled: false, queries: [], pages: 2 },
  filter: { models: [] },
  deals: {
    minDiscount: 0.2,
    maxDiscount: 0.45,
    minSamples: 6,
    windowDays: 7,
    maxPerRun: 5,
    renotifyDrop: 0.03,
    minDiscountVsShops: 0.05,
    bestMinDrop: 0.02,
  },
  watch: [],
  requestDelayMs: 2500,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function mergeConfig(user: DeepPartial<Config>): Config {
  return {
    ...DEFAULTS,
    ...user,
    olx: { ...DEFAULTS.olx, ...user.olx },
    hotline: { ...DEFAULTS.hotline, ...user.hotline },
    rozetka: { ...DEFAULTS.rozetka, ...user.rozetka },
    prom: { ...DEFAULTS.prom, ...user.prom },
    filter: { ...DEFAULTS.filter, ...user.filter },
    deals: { ...DEFAULTS.deals, ...user.deals },
    watch: user.watch ?? DEFAULTS.watch,
  } as Config;
}

export function validateConfig(c: Config): string[] {
  const errs: string[] = [];
  const d = c.deals;
  const anySource =
    c.olx.enabled ||
    (c.hotline.enabled && c.hotline.urls.length > 0) ||
    (c.rozetka.enabled && c.rozetka.queries.length > 0) ||
    (c.prom.enabled && c.prom.queries.length > 0);
  if (!anySource) errs.push('увімкни хоча б одне джерело (olx, hotline, rozetka, prom)');
  for (const m of c.filter.models)
    if (!/^iphone .+ (64|128|256|512)gb$|^iphone .+ [12]tb$/.test(m))
      errs.push(`filter.models: "${m}" — формат "iphone 17 pro 256gb"`);
  if (!(d.minDiscount > 0 && d.minDiscount < d.maxDiscount && d.maxDiscount < 1))
    errs.push('deals: має бути 0 < minDiscount < maxDiscount < 1');
  if (d.minSamples < 3) errs.push('deals.minSamples: щонайменше 3');
  if (c.olx.pageSize < 1 || c.olx.pageSize > 50) errs.push('olx.pageSize: 1..50');
  for (const u of c.hotline.urls) if (!/^https:\/\/hotline\.ua\//.test(u)) errs.push(`hotline.urls: ${u} — не схоже на hotline.ua`);
  for (const r of c.watch) {
    if (!/^iphone\s/.test(r.model.toLowerCase())) errs.push(`watch: "${r.model}" — модель має починатися з "iphone"`);
    if (!(r.maxPrice > 0)) errs.push(`watch: "${r.model}" — потрібен maxPrice`);
  }
  return errs;
}

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as DeepPartial<Config>;
  const cfg = mergeConfig(raw);
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`Помилки в ${path}:\n- ${errs.join('\n- ')}`);
  return cfg;
}

export interface Env {
  botToken?: string;
  chatId?: string;
  dryRun: boolean;
  statePath: string;
  configPath: string;
}

export function readEnv(env = process.env, argv = process.argv): Env {
  return {
    botToken: env.BOT_TOKEN || undefined,
    chatId: env.CHAT_ID || undefined,
    dryRun: env.DRY_RUN === 'true' || env.DRY_RUN === '1' || argv.includes('--dry-run'),
    statePath: env.STATE_PATH || 'data/state.json',
    configPath: env.CONFIG_PATH || 'config.json',
  };
}
