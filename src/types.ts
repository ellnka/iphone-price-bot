export type Condition = 'new' | 'used';

/** Одне оголошення / пропозиція з будь-якого джерела. */
export interface Offer {
  source: string;
  id: string;
  title: string;
  price: number; // UAH
  previousPrice?: number; // якщо продавець знизив ціну
  url: string;
  condition: Condition;
  sellerId?: string;
  business?: boolean;
  city?: string;
  createdAt?: string;
  /** пам'ять з окремого поля оголошення ("256gb"), якщо сайт його має */
  storage?: string;
  /** стан пристрою словами: "як новий", "добрий"... */
  grade?: string;
  /** здоров'я батареї: "85–89%" */
  battery?: string;
  /** назва магазину / продавця для повідомлення */
  seller?: string;
}

/** Ціна товару на агрегаторі (мінімум по магазинах). */
export interface PricePoint {
  source: string;
  url: string;
  title: string;
  lowPrice: number;
  highPrice?: number;
  offerCount?: number;
}

export interface Deal {
  kind: 'market' | 'watch' | 'new-low' | 'best';
  source: string;
  id: string; // унікальний ключ для анти-дублювання
  modelKey: string;
  title: string;
  price: number;
  url: string;
  reference?: number; // медіана ринку або попередній мінімум
  /** підпис до reference: "медіана", "Hotline мін.", "мін. за 30 днів" */
  referenceLabel?: string;
  discount?: number; // 0..1
  previousPrice?: number;
  city?: string;
  note?: string;
  /** стан / батарея — щоб одразу бачити, чому дешевше */
  details?: string;
  sellerId?: string;
  seller?: string;
  /** ключ для анти-дублів, якщо він не "source:id" (напр. найкраща ціна моделі) */
  notifyKey?: string;
}

export interface Config {
  olx: {
    enabled: boolean;
    queries: string[];
    categoryId: number;
    pages: number;
    pageSize: number;
    minPrice: number;
    skipBusiness: boolean;
    /** OLX: пропускати оголошення зі станом "з дефектами" */
    skipDefects: boolean;
  };
  hotline: {
    enabled: boolean;
    urls: string[];
    minDrop: number;
  };
  rozetka: {
    enabled: boolean;
    queries: string[];
  };
  prom: {
    enabled: boolean;
    queries: string[];
    pages: number;
  };
  /** стежити лише за цими моделями / станом (порожньо = за всіма) */
  filter: {
    models: string[]; // "iphone 17 pro 256gb" — покриває і eSIM-версію
    condition?: Condition;
    /** true: SIM і eSIM-версії — один ринок (найкраща ціна й орієнтир рахуються разом) */
    ignoreEsim?: boolean;
  };
  deals: {
    minDiscount: number;
    maxDiscount: number;
    minSamples: number;
    windowDays: number;
    maxPerRun: number;
    renotifyDrop: number;
    /** нове: оголошення дешевше за найдешевший магазин на Hotline на стільки — угода */
    minDiscountVsShops: number;
    /** найкраща ціна серед усіх джерел упала на стільки нижче мінімуму за 30 днів */
    bestMinDrop: number;
  };
  watch: WatchRule[];
  requestDelayMs: number;
}

export interface WatchRule {
  /** наприклад "iphone 16 pro" — без пам'яті */
  model: string;
  /** "256gb" | "1tb"; якщо не задано — будь-яка */
  storage?: string;
  condition?: Condition;
  maxPrice: number;
}
