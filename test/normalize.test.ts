import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeTitle, isJunk, looksUsed } from '../src/normalize.ts';

const key = (t: string) => normalizeTitle(t)?.key ?? null;

test('реальні заголовки з OLX', () => {
  assert.equal(key('iPhone 16 pro max 512 gb'), 'iphone 16 pro max 512gb');
  assert.equal(key('Iphone 16 Pro max, 256gb Neverlock'), 'iphone 16 pro max 256gb');
  assert.equal(key('Скло на iphone 16 pro з ефектом антишпигун'), null);
});

test('різні написання моделі', () => {
  const cases: Array<[string, string | null]> = [
    ['Apple iPhone 15 128GB Black (MTP03)', 'iphone 15 128gb'],
    ['IPHONE15PRO 256GB', 'iphone 15 pro 256gb'],
    ['iPhone 15 ProMax 1TB Natural', 'iphone 15 pro max 1tb'],
    ['iphone 14 promax 128', 'iphone 14 pro max 128gb'],
    ['Айфон 13 про макс 256 гб', 'iphone 13 pro max 256gb'],
    ['Айфон 14 плюс 128гб', 'iphone 14 plus 128gb'],
    ['iPhone 13 mini 128', 'iphone 13 mini 128gb'],
    ['Айфон 12 міні 64 Гб', 'iphone 12 mini 64gb'],
    ['iPhone 16e 128GB', 'iphone 16e 128gb'],
    ['iPhone Air 256GB Sky Blue', 'iphone air 256gb'],
    ['iPhone 17 Pro Max 2TB', 'iphone 17 pro max 2tb'],
    ['іPhone 15 Pro 256', 'iphone 15 pro 256gb'], // кирилична "і"
    ['iPhone XS Max 64gb', 'iphone xs max 64gb'],
    ['Iphone 15 pro 256 акб 100%', 'iphone 15 pro 256gb'],
    ['iPhone 15 Pro 256GB, батарея 98%, Neverlock', 'iphone 15 pro 256gb'],
  ];
  for (const [title, expected] of cases) assert.equal(key(title), expected, title);
});

test('неоднозначна або відсутня пам’ять → null', () => {
  assert.equal(key('iPhone 15 Pro'), null);
  assert.equal(key('iPhone 11 64/128/256'), null);
  assert.equal(key('iPhone 13 128 / 256 gb в наявності'), null);
});

test('не телефон або проблемний телефон → null', () => {
  const junk = [
    'Чохол iPhone 15 Pro 256',
    'Дисплей iPhone 14 Pro оригінал',
    'iPhone 13 128 iCloud lock',
    'iPhone 12 64gb заблокований',
    'iPhone 14 Pro 256 на запчастини',
    'iPhone 15 Pro Max 256 копія',
    'iPhone 15 Pro Max 256 реплика',
    'iPhone 13 128 R-SIM',
    'iPhone 14 128 розбитий',
    'iPhone 12 64 не вмикається',
    'iPhone 16 Pro 256 в розстрочку',
    'iPhone 15 128 оренда',
    'Материнська плата iPhone 13 128',
  ];
  for (const t of junk) assert.equal(key(t), null, t);
});

test('аксесуар після моделі — це подарунок, а не товар', () => {
  assert.equal(key('iPhone 13 Pro 128 + чохол у подарунок'), 'iphone 13 pro 128gb');
  assert.equal(key('iPhone 14 Pro 256, скло і зарядка в комплекті'), 'iphone 14 pro 256gb');
  assert.equal(key('Захисне скло iPhone 14 Pro 256'), null);
  assert.equal(key('Кабель для iPhone 15 128'), null);
});

test('позитивні слова не вважаються сміттям', () => {
  assert.equal(isJunk('iPhone 15 Pro 256 Neverlock'), false);
  assert.equal(isJunk('iPhone 15 Pro 256 unlocked'), false);
  assert.equal(isJunk('iPhone 14 128, оплата при отриманні'), false);
  assert.equal(isJunk('iPhone 13 128 iCloud чистий'), false);
});

test('живі заголовки OLX (листопад 2026) + поле storage', () => {
  // [заголовок, storage з OLX або undefined, очікуваний ключ]
  const live: Array<[string, string | undefined, string | null]> = [
    ['IPhone 15 Pro 128Gb Neverlock стан 7/10', undefined, 'iphone 15 pro 128gb'],
    ['Apple iphone 15 Pro Max 256 gb айфон Про Макс 100%', undefined, 'iphone 15 pro max 256gb'],
    ['iPhone 15 в розовом цвете/предлагайте свою цену', undefined, null],
    ['iPhone 15 Pro Max 256 GB Neverlock | Магазин | Гарантія', undefined, 'iphone 15 pro max 256gb'],
    ['iPhone 15 pro 256gb', '256gb', 'iphone 15 pro 256gb'],
    ['iphone 15 plus 128gb', '128gb', 'iphone 15 plus 128gb'],
    ['Ідеальний iPhone 6s 16GB 85%АКБ Space Gray (Магазин Гарантія)', '16gb', null],
    ['Iphone 15 pro , Айфон 15 про 256 ідеальний , свій,  фізична сім', '256gb', 'iphone 15 pro 256gb'],
    ['Смартфон Apple iPhone 15 Pro Max 512GB eSIM (184808) Б/У З ГАРАНТІЄЮ', undefined, 'iphone 15 pro max 512gb esim'],
    ['iPhone 15 Pro Max 256 ГБ еSIM заблокований', '256gb', null],
    ['iPhone  15 pro max в отличном состоянии', '256gb', 'iphone 15 pro max 256gb'],
    ['Айфон 15 Про Макс 256/512/1Т IPhone 15 Pro Max Blue Titamium', undefined, null],
    ['iPhone 17Pro 256Gb Blue (Кредит Обмін Xr/11/12/13pro/14/15/16Pro max OLX доставка Гарантія)', undefined, null],
    ['Iphone 15 на 128, 86% акум, все рідне, гарний стан', '128gb', 'iphone 15 128gb'],
    ['Iphone 15 Pro Max оригинал полный комплект', undefined, null],
    ['iPhone 15 Pro Max 256 GB Natural/ Neverlock/ 89% АКБ/ Айфон 15 Про Макс 256 ГБ', '256gb', 'iphone 15 pro max 256gb'],
    ['iPhone 15 Pro | 128 GB', '128gb', 'iphone 15 pro 128gb'],
    ['Apple iPhone 15 plus 128 gb. Неверлок, акб 89%', '128gb', 'iphone 15 plus 128gb'],
    ['Iphone 15 pro 128 gb, ідеальний стан, 100 акб, айфон 15 про 128гб', undefined, 'iphone 15 pro 128gb'],
    ['iPhone 15 Pro Max, Blue Titanium esim/ фіз.Sim Обмін/Гарантія', undefined, null],
  ];
  for (const [title, storage, expected] of live) {
    assert.equal(normalizeTitle(title, storage)?.key ?? null, expected, title);
  }
});

test('поле storage: доповнює заголовок, а конфлікт → null', () => {
  assert.equal(normalizeTitle('iPhone 16 Pro', '512gb')?.key, 'iphone 16 pro 512gb');
  assert.equal(normalizeTitle('iPhone 16 Pro 256GB', '256gb')?.key, 'iphone 16 pro 256gb');
  assert.equal(normalizeTitle('iPhone 16 Pro 512GB', '256gb'), null);
  assert.equal(normalizeTitle('iPhone 16 Pro', '16gb'), null); // невалідна пам'ять для iPhone 11+
});

test('живі кейси OLX: bypass, дефект, Air', () => {
  assert.equal(key('IPhone 16 E Bypass Black 128'), null);
  assert.equal(key('Iphone 16E bypass 128гб черний'), null);
  assert.equal(key('iPhone 14 Pro 128 go newerlock в гарному стані є невеликий дефект'), null);
  assert.equal(key('iPhone 14 Pro 128 ідеал, без дефектів'), 'iphone 14 pro 128gb');
  assert.equal(key('iPhone 17Air,256GB,Black!Neverlock!Гарантія!Магазин!'), 'iphone air 256gb');
  assert.equal(key('Гарантія ! iPhone 17 Air 256 GB. Айфон 17 Аір 256 ГБ.'), 'iphone air 256gb');
  assert.equal(key('Продаю Айфон 17 Eir на 256 гб'), 'iphone air 256gb');
  assert.equal(key('iPhone 17 Pro, 1 ТБ, eSIM'), 'iphone 17 pro 1tb esim');
  assert.equal(key('Iphone 16 pro 128 gb - 256 gb'), null);
  assert.equal(key('iPhone 16 Pro Max China Китай 256'), null);
  assert.equal(normalizeTitle('Apple iPhone 14 Pro 1TB Space Black 100% Neverlock', '256gb'), null); // конфлікт заголовка й поля
});

test('живі кейси OLX: кілька згадок iphone, "iPhone Apple", опис стану екрана/корпусу', () => {
  assert.equal(normalizeTitle('Айфон | iPhone 13 Pro 128GB AKB 100% Нова| ОПТ | Гарантія! (684918)', '128gb')?.key, 'iphone 13 pro 128gb');
  assert.equal(key('iPhone Айфон 13,128GB,Pink!Neverlock!Магазин!Гарантия!'), 'iphone 13 128gb');
  assert.equal(normalizeTitle('iPhone Apple 14 Pro Max 256gb', '256gb')?.key, 'iphone 14 pro max 256gb');
  assert.equal(
    normalizeTitle('Iphone 14pro 128gb esim 95%батерея .Екран без подряпин,корпус теж ок.тільки Хмельницький Самовивіз', '128gb')?.key,
    'iphone 14 pro 128gb esim',
  );
  assert.equal(key('Дисплей iPhone 14 Pro 128 оригінал'), null);
  assert.equal(key('Корпус iPhone 13 128 зелений'), null);
  assert.equal(key('Камера для iPhone 15 Pro 256'), null);
});

test('eSIM-версія — окремий ринок; "SIM + eSIM" і "фіз. сім" — ні', () => {
  const info = normalizeTitle('Apple iPhone 17 Pro 256GB eSIM Deep Blue (MG7M4)')!;
  assert.deepEqual([info.key, info.base, info.esim], ['iphone 17 pro 256gb esim', 'iphone 17 pro 256gb', true]);
  assert.equal(key('Apple iPhone 17 Pro 256GB Deep Blue (MG8J4)'), 'iphone 17 pro 256gb');
  assert.equal(key('iPhone 17 Pro Max, 512 ГБ, SIM + eSIM'), 'iphone 17 pro max 512gb');
  assert.equal(key('iPhone 16 Pro Max 256Gb White з фіз сім'), 'iphone 16 pro max 256gb');
  assert.equal(key('Iphone 16 Pro Max 256gb e-sim'), 'iphone 16 pro max 256gb esim');
  assert.equal(key('iPhone 17 Pro 256 еSIM новий'), 'iphone 17 pro 256gb esim'); // кирилична "е"
  assert.equal(key('IPhone 17 Pro 256gb Neverlock (Only eSIM)'), 'iphone 17 pro 256gb esim');
});

test('MDM-профіль — сміття', () => {
  assert.equal(key('MDM ПРОФІЛЬ !!!Смартфон Apple iPhone 17 Pro 256GB Silver (MG8G4) НОВИЙ!!!'), null);
});

test('looksUsed: живі заголовки Prom/Rozetka (листопад 2026)', () => {
  const used = [
    'Смартфон Apple iPhone 17 Pro 256GB Deep Blue (MG8J4) Б/У [180815]',
    'Apple iPhone 17 Pro 256gb e-SIM Battery: 100%, 27 циклів',
    'Apple iPhone 17 Pro 256GB Cosmic Orange eSIM б/у B+, аккумулятор 95 100%, гарант',
    'IPhone 17 Pro 256gb Cosmic Orange 100% (44 цикли зарядки) Neverlock (Only eSIM)',
    'Смартфон Apple iPhone 17 Pro 256GB Deep Blue (Чудовий стан) АКБ 100% (Вживаний)',
    'Смартфон Apple iPhone 17 Pro 256 GB Cosmic Orange (Grade B) - Б/В',
    'Apple iPhone 17 Pro 256GB Cosmic Orange (MG8H4) (Відновлений, Як новий)',
    'iPhone 15 128 GB Trade in',
    'Iphone 15 pro 128 gb, ідеальний стан, 100 акб',
  ];
  const fresh = [
    'Смартфон iPhone 17 Pro 256GB Silver',
    'Мобільний телефон Apple iPhone 17 Pro 256GB Silver (MG8G4AF/A)',
    'Apple iPhone 17 Pro 256GB eSIM Deep Blue (MG7M4)',
    'iPhone 17 Pro 256gb new e sim новий',
    'Смартфон Apple iPhone 17 Pro 256GB Cosmic Orange (MG8H4) Офіційна гарантія',
  ];
  for (const t of used) assert.equal(looksUsed(t), true, t);
  for (const t of fresh) assert.equal(looksUsed(t), false, t);
});
