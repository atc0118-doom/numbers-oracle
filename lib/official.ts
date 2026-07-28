import type { Draw, Game } from './types';

const RAKUTEN_BASE = 'https://takarakuji.rakuten.co.jp/backnumber/bank/';
const MIZUHO_BASE = 'https://www.mizuhobank.co.jp/takarakuji/check/numbers';

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

async function fetchRaw(url: string, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NumbersOracle/6.4; +https://vercel.app)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ja-JP,ja;q=0.9',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

const yen = (value?: string) => value ? Number(value.replace(/[,，円\s]/g, '')) || null : null;
const jpDate = (value: string) => {
  const match = value.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value;
};

function parseIsoDate(value: string) {
  const m = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
}

function weekdayNext(iso: string) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  do dt.setUTCDate(dt.getUTCDate()+1); while ([0,6].includes(dt.getUTCDay()));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}

/** 楽天銀行の月別当せん番号ページを解析する。 */
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
      game,
      round: Number(match[1]),
      date: jpDate(match[2]),
      number: match[3],
      source: 'bank-fallback',
      payouts: { straight: yen(straight?.[1]), box: yen(box?.[1]) },
    });
  }
  return rows;
}

/** みずほ銀行「今月の当せん番号」から最新結果を1回だけ取得。 */
async function fetchMizuhoLatest(game: Game): Promise<Draw | null> {
  try {
    const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
    const digits = game === 'numbers3' ? 3 : 4;
    const text = clean(await fetchRaw(`${MIZUHO_BASE}/${slug}/index.html`, 5000));
    const re = new RegExp(`第(\\d+)回[\\s\\S]{0,160}?(\\d{4})年(\\d{1,2})月(\\d{1,2})日[\\s\\S]{0,180}?(?:抽せん数字|当せん番号)\\s*(\\d{${digits}})`, 'g');
    const rows: Draw[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      rows.push({
        game,
        round: Number(m[1]),
        date: `${m[2]}年${Number(m[3])}月${Number(m[4])}日`,
        number: m[5],
        source: 'bank-fallback',
      });
    }
    return rows.sort((a,b) => b.round-a.round)[0] ?? null;
  } catch {
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

/**
 * V6.4: 外部アクセスを固定5本までに削減。
 * みずほ最新1本 + 楽天直近4か月を並列取得し、suusen.net補完は廃止。
 */
export async function fetchOfficialHistory(game: Game, limit = 70): Promise<Draw[]> {
  const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
  const months = monthKeys(4);
  const [latestResult, ...historyResults] = await Promise.allSettled([
    fetchMizuhoLatest(game),
    ...months.map(async ym => parseRakuten(await fetchRaw(`${RAKUTEN_BASE}${slug}/${ym}/`), game)),
  ]);

  const map = new Map<number, Draw>();
  for (const result of historyResults) {
    if (result.status !== 'fulfilled') continue;
    for (const row of result.value) map.set(row.round, row);
  }
  if (latestResult.status === 'fulfilled' && latestResult.value) {
    map.set(latestResult.value.round, latestResult.value);
  }

  const rows = [...map.values()].sort((a, b) => b.round - a.round).slice(0, limit);
  if (rows.length < 50) throw new Error(`公開当せん履歴が不足しています（${rows.length}回）`);
  return rows;
}

export async function fetchLatest(game: Game) {
  const rows = await fetchOfficialHistory(game, 30);
  return rows[0];
}

export function nextDrawDate(japaneseDate: string) {
  const iso = parseIsoDate(japaneseDate);
  return iso ? weekdayNext(iso) : null;
}
