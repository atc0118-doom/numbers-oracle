import type { Draw, Game } from './types';

const RAKUTEN_BASE = 'https://takarakuji.rakuten.co.jp/backnumber/bank/';

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
        'user-agent': 'Mozilla/5.0 (compatible; NumbersOracle/6.2; +https://vercel.app)',
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

/** 楽天銀行の月別当せん番号ページを解析する。 */
function parseRakuten(html: string, game: Game): Draw[] {
  const text = clean(html);
  const digits = game === 'numbers3' ? 3 : 4;
  const rows: Draw[] = [];

  // 月別ページは「回号→抽せん日→当せん番号→ストレート→ボックス」の順。
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
 * Vercel上で60秒タイムアウトしないよう、必要月を一括並列取得する。
 * 160回なら通常8〜10か月分で足りる。
 */
export async function fetchOfficialHistory(game: Game, limit = 160): Promise<Draw[]> {
  const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
  const monthCount = Math.min(12, Math.max(4, Math.ceil(limit / 18) + 2));
  const months = monthKeys(monthCount);
  const results = await Promise.allSettled(
    months.map(async ym => parseRakuten(await fetchRaw(`${RAKUTEN_BASE}${slug}/${ym}/`), game)),
  );
  const map = new Map<number, Draw>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const row of result.value) map.set(row.round, row);
  }
  const rows = [...map.values()].sort((a, b) => b.round - a.round).slice(0, limit);
  if (rows.length < 60) throw new Error(`公開当せん履歴が不足しています（${rows.length}回）`);
  return rows;
}

export async function fetchLatest(game: Game) {
  const rows = await fetchOfficialHistory(game, 30);
  return rows[0];
}

export function nextDrawDate(japaneseDate: string) {
  const match = japaneseDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  do date.setUTCDate(date.getUTCDate() + 1); while ([0, 6].includes(date.getUTCDay()));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
