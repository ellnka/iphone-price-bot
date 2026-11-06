/**
 * Перетворює довільний заголовок оголошення на канонічний ключ моделі:
 *   "Iphone 16 Pro max, 256gb Neverlock" -> { model: "iphone 16 pro max", storage: "256gb" }
 * Повертає null, якщо це аксесуар / запчастина / підозріле оголошення
 * або якщо модель чи пам'ять неможливо визначити однозначно.
 */

export interface ModelInfo {
  model: string; // "iphone 16 pro max"
  storage: string; // "256gb" | "1tb"
  /** версія лише з eSIM (американська) — зазвичай на 8–10% дешевша, тому окремий ринок */
  esim: boolean;
  base: string; // "iphone 16 pro max 256gb" — без урахування eSIM
  key: string; // "iphone 16 pro max 256gb" або "iphone 16 pro max 256gb esim"
}

const L = '\\p{L}\\p{N}';
/** Слово з юнікод-межами (\b у JS не працює з кирилицею). */
const word = (w: string, global = false) =>
  new RegExp(`(?<![${L}])(?:${w})(?![${L}])`, global ? 'giu' : 'iu');
/** Початок слова (корінь): "запчаст" ловить "запчастини". */
const stem = (w: string) => new RegExp(`(?<![${L}])(?:${w})`, 'iu');

/** Ознаки, що це не телефон або телефон з проблемою. Перевіряються по заголовку. */
const JUNK: RegExp[] = [
  // блокування
  /icloud\s*lock/i,
  stem('заблок'),
  stem('залоч'),
  stem('locked'),
  word('r-?sim'),
  /sim[\s-]?lock/i,
  stem('bypass|байпас'), // обхід блокування iCloud
  word('mdm|мдм'), // корпоративне керування — телефон прив'язаний до чужої організації
  // запчастини, донори
  stem('запчаст'),
  word('з/ч'),
  stem('донор'),
  stem('розбор|разбор'),
  word('плат[аиу]'),
  // підробки
  stem('копі[яюї]|копи[яю]'),
  stem('репл[іи]к'),
  stem('replica'),
  word('китай|clone|fake|dummy'),
  stem('муляж|макет'),
  // пошкодження
  stem('розбит|разбит'),
  /не\s*(вмика|включа|працю|работа)/i,
  stem('тріщин|трещин'),
  /(?<!без\s{0,3})дефект/i, // "є дефект", але не "без дефектів"
  // не разова ціна
  stem('розстроч|рассроч|кредит|оренд|аренд|прокат'),
  /\/\s*міс|\/\s*мес/i,
];

/**
 * Аксесуари й запчастини — лише якщо стоять ПЕРЕД моделлю: "Чохол для iPhone 15" — сміття,
 * а "iPhone 15 128 + чохол у подарунок" чи "iPhone 14 Pro, екран без подряпин" — нормальні оголошення.
 */
const ACCESSORY: RegExp[] = [
  stem('чох[оа]л|чехл|чехол'),
  word('скло|стекло|case|кейс|бампер'),
  stem('плівк|пленк'),
  stem('кабел|зарядк|навушник|airpods|ремін|тримач|держател'),
  // запчастини теж зазвичай на початку: "Дисплей iPhone 14 Pro"
  stem('корпус|дисплей|екран|экран|камер|шлейф'),
];

const CYR_WORDS: Array<[RegExp, string]> = [
  [/[iі]phone|айфон[а-яіїєґ]*/giu, ' iphone '],
  [word('про\\s*макс|промакс', true), ' pro max '],
  [word('про', true), ' pro '],
  [word('макс', true), ' max '],
  [word('плюс', true), ' plus '],
  [word('міні|мини', true), ' mini '],
  [word('ейр|эйр|аір|аир|эир|eir', true), ' air '],
];

const VALID_STORAGE_GB = new Set([64, 128, 256, 512]);

/**
 * Ознаки вживаного телефона в заголовку. Потрібні там, де сайт не має окремого поля
 * стану (Prom), і як запобіжник, коли продавець на OLX ставить "нове" вживаному.
 */
const USED: RegExp[] = [
  stem('б/у|б/в|б\\.у\\.'),
  word('бу|бв|used'),
  stem('вживан|використан|уживан'),
  stem('відновлен|восстановлен|refurb'),
  word('ref|cpo'),
  /grade\s*[a-dq]\b/i,
  stem('trade[\\s-]?in|трейд'),
  stem('уцін|уцен'),
  stem('демо|demo'),
  /\d+\s*(цикл|cycle)/i,
  /(акб|батаре\p{L}*|акум\p{L}*|battery)\s*:?\s*\d{2,3}\s*%/iu,
  /\d{2,3}\s*%\s*(акб|батаре|акум|battery)/iu,
  stem('як нов|как нов|like new'),
  /(чудов|ідеальн|гарн|відмінн|хорош|отличн|идеальн|супер)\p{L}*\s+(стан|состоян)/iu,
];

export function looksUsed(title: string): boolean {
  return USED.some((re) => re.test(title));
}

const ESIM = /(?<![a-zа-яіїє])[eе][\s-]?sim|есім|есим/iu;
const DUAL = /sim\s*\+\s*[eе][\s-]?sim|[eе][\s-]?sim\s*\+|фіз|физ|physical|nano[\s-]?sim|dual[\s-]?sim|2\s*sim/iu;

/** "eSIM", "Only eSIM", "e-sim" — але не "SIM + eSIM" чи "фіз. сім + eSIM". */
export function isEsimOnly(title: string): boolean {
  return ESIM.test(title) && !DUAL.test(title);
}

export function isJunk(title: string): boolean {
  if (JUNK.some((re) => re.test(title))) return true;
  const at = title.search(/[iі]phone|айфон/iu);
  const prefix = at === -1 ? title : title.slice(0, at);
  return ACCESSORY.some((re) => re.test(prefix));
}

const VALID_HINT = /^(64|128|256|512)gb$|^[12]tb$/;

/**
 * @param storageHint пам'ять з окремого поля оголошення (OLX: "256gb").
 *   Використовується, якщо в заголовку пам'яті немає. Якщо в заголовку інша
 *   пам'ять, ніж у полі, — оголошення неоднозначне, пропускаємо.
 */
export function normalizeTitle(title: string, storageHint?: string): ModelInfo | null {
  if (!title || isJunk(title)) return null;

  let s = title.toLowerCase();
  for (const [re, rep] of CYR_WORDS) s = s.replace(re, rep);
  s = s
    .replace(/гб/g, 'gb')
    .replace(/тб/g, 'tb')
    .replace(/promax/g, 'pro max')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9%\s]/g, ' ');

  const t = s.split(/\s+/).filter(Boolean);
  const model = parseModel(t);
  if (!model) return null;

  const inTitle = parseStorage(t);
  if (inTitle.size > 1) return null; // "128/256/512" — кілька варіантів, ціна неоднозначна
  const fromTitle = [...inTitle][0];
  const hint = storageHint?.toLowerCase().replace(/\s+/g, '');
  const fromHint = hint && VALID_HINT.test(hint) ? hint : undefined;
  if (fromTitle && fromHint && fromTitle !== fromHint) return null;

  const storage = fromTitle ?? fromHint;
  if (!storage) return null;
  const esim = isEsimOnly(title);
  const base = `${model} ${storage}`;
  return { model, storage, esim, base, key: esim ? `${base} esim` : base };
}

function parseModel(t: string[]): string | null {
  // "Айфон | iPhone 13 Pro" → перша згадка без моделі, беремо наступну
  for (let i = t.indexOf('iphone'); i !== -1; i = t.indexOf('iphone', i + 1)) {
    const m = parseModelAt(t, i);
    if (m) return m;
  }
  return null;
}

function parseModelAt(t: string[], i: number): string | null {
  let j = i + 1;
  if (t[j] === 'apple') j++; // "iPhone Apple 14 Pro Max"
  let gen: string | null = null;

  const tok = t[j];
  if (tok && /^1[1-9]$/.test(tok)) {
    gen = tok;
    j++;
  } else if (tok && /^(se|xr|xs|x)$/.test(tok)) {
    gen = tok;
    j++;
  }

  const variant: string[] = [];
  const next = t[j];
  if (next === 'pro') {
    variant.push('pro');
    if (t[j + 1] === 'max') variant.push('max');
  } else if (next === 'max' && gen === 'xs') {
    variant.push('max');
  } else if (next === 'plus' || next === 'mini' || next === 'air' || next === 'fold') {
    variant.push(next);
  } else if (next === 'e' && gen && /^\d+$/.test(gen)) {
    // "16 e" після розклеювання "16e"
    gen = `${gen}e`;
  }

  // "iPhone 17 Air" і "iPhone Air" — одна модель (офіційно без номера)
  if (variant[0] === 'air') return 'iphone air';
  if (!gen && variant[0] !== 'fold') return null;
  return ['iphone', gen, ...variant].filter(Boolean).join(' ');
}

function parseStorage(t: string[]): Set<string> {
  const found = new Set<string>();

  for (let k = 0; k < t.length; k++) {
    const n = Number(t[k]);
    if (!Number.isInteger(n)) continue;
    const unit = t[k + 1];
    if (unit === 'tb' && (n === 1 || n === 2)) found.add(`${n}tb`);
    else if (n === 1024 && (unit === 'gb' || unit === 'g')) found.add('1tb');
    // "256gb", "256 g" або просто "256" ("iPhone 15 Pro 256 Black")
    else if (VALID_STORAGE_GB.has(n) && unit !== '%') found.add(`${n}gb`);
  }

  return found;
}
