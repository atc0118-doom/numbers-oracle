import type { Draw, Game } from './types';

const RAKUTEN_BASE = 'https://takarakuji.rakuten.co.jp/backnumber/bank/';
const LOTO_LIFE: Record<Game, string> = {
  numbers3: 'https://loto-life.net/numbers3',
  numbers4: 'https://loto-life.net/public/index.php/numbers4',
};

const decode = (v: string) => v
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'");

const clean = (html: string) => decode(
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/t[rdh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' '),
).replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');

async function fetchRaw(url: string, timeoutMs = 5500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NumbersOracle/7.0; +https://vercel.app)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ja-JP,ja;q=0.9',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

const yen = (value?: string) => (value ? Number(value.replace(/[,，円\s]/g, '')) || null : null);
const jpDate = (value: string) => {
  const match = value.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value;
};

function parseIsoDate(value: string) {
  const m = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Japanese holiday lookup
//
// Numbers 3/4 draws don't happen on weekends OR on Japanese public holidays.
// The previous version only checked weekends, so a cron run right after a
// holiday could misfire a false "source is stale" error. We fetch the
// official holidays-jp dataset (used by many Japanese calendar tools) for
// the current + next year and cache it in-process, falling back to
// weekend-only logic if the lookup fails for any reason (network issue,
// unexpected response shape, etc.) so a holiday-API outage never breaks
// the core sync.
// ---------------------------------------------------------------------------

const HOLIDAY_API_TIMEOUT_MS = 4000;
const HOLIDAY_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — holidays don't change intra-day
let holidayCache: { dates: Set<string>; fetchedAt: number } | null = null;

async function fetchHolidayYear(year: number, signal: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`holidays-jp HTTP ${response.status}`);
  return response.json();
}

/** Returns a Set of "YYYY-MM-DD" Japanese public holiday dates for this year and next. Falls back to the last successful fetch (or empty) on error. */
async function japaneseHolidays(): Promise<Set<string>> {
  if (holidayCache && Date.now() - holidayCache.fetchedAt < HOLIDAY_CACHE_TTL_MS) return holidayCache.dates;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOLIDAY_API_TIMEOUT_MS);
  try {
    const year = new Date().getUTCFullYear();
    const [thisYear, nextYear] = await Promise.all([
      fetchHolidayYear(year, controller.signal),
      fetchHolidayYear(year + 1, controller.signal),
    ]);
    const dates = new Set<string>([...Object.keys(thisYear), ...Object.keys(nextYear)]);
    holidayCache = { dates, fetchedAt: Date.now() };
    return dates;
  } catch (e) {
    console.warn('[oracle] holiday lookup failed, falling back to weekend-only logic', e instanceof Error ? e.message : String(e));
    return holidayCache?.dates ?? new Set();
  } finally {
    clearTimeout(timeout);
  }
}

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

async function isNonDrawDay(iso: string): Promise<boolean> {
  if (isWeekend(iso)) return true;
  const holidays = await japaneseHolidays();
  return holidays.has(iso);
}

function shiftIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function nextDrawDay(iso: string): Promise<string> {
  let candidate = shiftIso(iso, 1);
  while (await isNonDrawDay(candidate)) candidate = shiftIso(candidate, 1);
  return candidate;
}

async function previousDrawDay(iso: string): Promise<string> {
  let candidate = shiftIso(iso, -1);
  while (await isNonDrawDay(candidate)) candidate = shiftIso(candidate, -1);
  return candidate;
}

function jstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

const RESULTS_AVAILABLE_AFTER_MINUTES = 20 * 60 + 30; // 公式案内では数字選択式の最新結果は原則20:30すぎに照会可能

/** The most recent date a draw result should exist for, given the current JST time, weekends, and Japanese public holidays. */
export async function expectedLatestDrawDate(): Promise<string> {
  const now = jstNow();
  if (await isNonDrawDay(now.iso)) return previousDrawDay(now.iso);
  if (now.hour * 60 + now.minute < RESULTS_AVAILABLE_AFTER_MINUTES) return previousDrawDay(now.iso);
  return now.iso;
}

function parseRakuten(html: string, game: Game): Draw[] {
  const text = clean(html);
  const digits = game === 'numbers3' ? 3 : 4;
  const rows: Draw[] = [];
  const block = new RegExp(
    `回号\\s*第(\\d+)回[\\s\\S]{0,100}?抽せん日\\s*(\\d{4}[\\/-]\\d{1,2}[\\/-]\\d{1,2})[\\s\\S]{0,100}?当せん番号\\s*(\\d{${digits}})([\\s\\S]{0,280}?)(?=回号\\s*第\\d+回|$)`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = block.exec(text))) {
    const payoutText = match[4] ?? '';
    const straight = payoutText.match(/ストレート\s*(?:[\d,，]+口\s*)?([\d,，]+)円/);
    const box = payoutText.match(/ボックス\s*(?:[\d,，]+口\s*)?([\d,，]+)円/);
    rows.push({
      game, round: Number(match[1]), date: jpDate(match[2]), number: match[3], source: 'bank-fallback',
      payouts: { straight: yen(straight?.[1]), box: yen(box?.[1]) },
    });
  }
  return rows;
}

/** 最新1回だけ補完。履歴学習は楽天銀行の掲載値を使用する。 */
async function fetchPublicLatest(game: Game): Promise<Draw | null> {
  try {
    const text = clean(await fetchRaw(LOTO_LIFE[game], 4500));
    const digits = game === 'numbers3' ? 3 : 4;
    const re = new RegExp(`回別\\s*第(\\d+)回[\\s\\S]{0,100}?抽選日\\s*(\\d{4})年(\\d{1,2})月(\\d{1,2})日[\\s\\S]{0,100}?当選番号\\s*(\\d{${digits}})[\\s\\S]{0,160}?ストレート\\s*(?:[\\d,，]+口\\s*)?([\\d,，]+)円[\\s\\S]{0,120}?ボックス\\s*(?:[\\d,，]+口\\s*)?([\\d,，]+)円`);
    const m = text.match(re);
    if (!m) return null;
    return {
      game, round: Number(m[1]), date: `${m[2]}年${Number(m[3])}月${Number(m[4])}日`, number: m[5], source: 'public-fallback',
      payouts: { straight: yen(m[6]), box: yen(m[7]) },
    };
  } catch (e) {
    console.warn('[oracle] latest supplement unavailable', game, e instanceof Error ? e.message : String(e));
    return null;
  }
}

function monthKeys(count: number) {
  const now = new Date();
  const output: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    output.push(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return output;
}

const MONTHS_TO_FETCH = 4; // months of Rakuten backnumber pages scraped per sync — keep in sync with scrape-load considerations in README

export async function fetchOfficialHistory(game: Game, limit = 70): Promise<Draw[]> {
  const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
  const months = monthKeys(MONTHS_TO_FETCH);
  const [latest, ...history] = await Promise.allSettled([
    fetchPublicLatest(game),
    ...months.map(async ym => parseRakuten(await fetchRaw(`${RAKUTEN_BASE}${slug}/${ym}/`), game)),
  ]);

  const byRound = new Map<number, Draw>();
  for (const result of history) {
    if (result.status !== 'fulfilled') continue;
    for (const row of result.value) byRound.set(row.round, row);
  }
  if (latest.status === 'fulfilled' && latest.value) {
    const existing = byRound.get(latest.value.round);
    byRound.set(latest.value.round, { ...existing, ...latest.value, payouts: latest.value.payouts ?? existing?.payouts });
  }

  const rows = [...byRound.values()].sort((a, b) => b.round - a.round).slice(0, limit);
  if (rows.length < 50) throw new Error(`HISTORY_SHORT:${rows.length}`);

  const latestIso = parseIsoDate(rows[0].date);
  const expected = await expectedLatestDrawDate();
  if (!latestIso || latestIso < expected) throw new Error(`SOURCE_STALE:${latestIso ?? 'unknown'}:${expected}`);

  return rows;
}

export async function fetchLatest(game: Game) {
  return (await fetchOfficialHistory(game, 30))[0];
}

/** Next expected draw date after `japaneseDate`, skipping weekends and Japanese public holidays. */
export async function nextDrawDate(japaneseDate: string): Promise<string | null> {
  const iso = parseIsoDate(japaneseDate);
  return iso ? nextDrawDay(iso) : null;
}
