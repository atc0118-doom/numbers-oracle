import type { Draw, Game } from './types';

const MIZUHO_LATEST: Record<Game, string> = {
  numbers3: 'https://www.mizuhobank.co.jp/takarakuji/check/numbers/numbers3/index.html',
  numbers4: 'https://www.mizuhobank.co.jp/takarakuji/check/numbers/numbers4/index.html',
};
const MIZUHO_BACK = 'https://www.mizuhobank.co.jp/takarakuji/check/numbers/backnumber/';
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

async function fetchRaw(url: string, retries = 2) {
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000 + attempt * 4000);
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
          referer: new URL(url).origin + '/',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${url}: ${last}`);
}

const yen = (value?: string) => value ? Number(value.replace(/[,，円\s]/g, '')) || null : null;
const jpDate = (value: string) => {
  const match = value.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value;
};

function parseMizuhoLatest(html: string, game: Game): Draw | null {
  const text = clean(html);
  const digits = game === 'numbers3' ? 3 : 4;
  const patterns = [
    new RegExp(`第\\s*(\\d+)\\s*回[\\s\\S]{0,220}?抽せん日\\s*(\\d{4}年\\d{1,2}月\\d{1,2}日)[\\s\\S]{0,160}?抽せん数字\\s*(\\d{${digits}})`),
    new RegExp(`第\\s*(\\d+)\\s*回[\\s\\S]{0,260}?(\\d{4}年\\d{1,2}月\\d{1,2}日)[\\s\\S]{0,120}?(\\d{${digits}})`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const after = text.slice(match.index ?? 0, (match.index ?? 0) + 900);
    const straight = after.match(/ストレート\s*(?:\d+口\s*)?([\d,，]+)円/);
    const box = after.match(/ボックス\s*(?:\d+口\s*)?([\d,，]+)円/);
    return {
      game,
      round: Number(match[1]),
      date: match[2],
      number: match[3],
      source: 'official',
      payouts: { straight: yen(straight?.[1]), box: yen(box?.[1]) },
    };
  }
  return null;
}

function parseRakuten(html: string, game: Game): Draw[] {
  const text = clean(html);
  const digits = game === 'numbers3' ? 3 : 4;
  const pattern = new RegExp(
    `回号\\s*(?:\\||---\\s*\\|?)?\\s*第(\\d+)回[\\s\\S]{0,90}?抽せん日\\s*(?:\\||---\\s*\\|?)?\\s*(\\d{4}[\\/-]\\d{1,2}[\\/-]\\d{1,2})[\\s\\S]{0,90}?当せん番号\\s*(?:\\||---\\s*\\|?)?\\s*(\\d{${digits}})[\\s\\S]{0,120}?ストレート\\s*(?:\\||---\\s*\\|?)?[^\\d]{0,30}(?:[\\d,，]+口)?[^\\d]{0,30}([\\d,，]+)円[\\s\\S]{0,100}?ボックス\\s*(?:\\||---\\s*\\|?)?[^\\d]{0,30}(?:[\\d,，]+口)?[^\\d]{0,30}([\\d,，]+)円`,
    'g',
  );
  const rows: Draw[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    rows.push({
      game,
      round: Number(match[1]),
      date: jpDate(match[2]),
      number: match[3],
      source: 'bank-fallback',
      payouts: { straight: yen(match[4]), box: yen(match[5]) },
    });
  }

  // 重複数字などでボックスが「該当なし」の場合も抽せんデータ自体は取得する。
  if (!rows.length) {
    const simple = new RegExp(
      `回号\\s*(?:\\||---\\s*\\|?)?\\s*第(\\d+)回[\\s\\S]{0,90}?抽せん日\\s*(?:\\||---\\s*\\|?)?\\s*(\\d{4}[\\/-]\\d{1,2}[\\/-]\\d{1,2})[\\s\\S]{0,90}?当せん番号\\s*(?:\\||---\\s*\\|?)?\\s*(\\d{${digits}})`,
      'g',
    );
    while ((match = simple.exec(text))) {
      rows.push({game, round: Number(match[1]), date: jpDate(match[2]), number: match[3], source: 'bank-fallback'});
    }
  }
  return rows;
}

function pageName(start: number) {
  return `num${String(start).padStart(4, '0')}.html`;
}

function parseMizuhoBack(html: string) {
  const text = clean(html);
  const output: {round: number; date: string; n3: string; n4: string}[] = [];
  const variants = [
    /第\s*(\d+)\s*回\s*(\d{4}年\d{1,2}月\d{1,2}日)\s*(\d{3})\s*(\d{4})/g,
    /第\s*(\d+)\s*回[\s\S]{0,80}?(\d{4}年\d{1,2}月\d{1,2}日)[\s\S]{0,80}?(\d{3})[\s\S]{0,80}?(\d{4})/g,
  ];
  for (const pattern of variants) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) output.push({round: Number(match[1]), date: match[2], n3: match[3], n4: match[4]});
    if (output.length) return output;
  }
  return output;
}

async function fetchMizuhoHistory(game: Game, limit: number): Promise<Draw[]> {
  const latestHtml = await fetchRaw(MIZUHO_LATEST[game], 1);
  const latest = parseMizuhoLatest(latestHtml, game);
  if (!latest) throw new Error('みずほ最新結果を解析できませんでした');
  const latestStart = Math.floor((latest.round - 1) / 20) * 20 + 1;
  const starts: number[] = [];
  for (let start = latestStart; start >= 1 && starts.length < Math.ceil(limit / 20) + 2; start -= 20) starts.push(start);
  const map = new Map<number, Draw>([[latest.round, latest]]);
  for (let i = 0; i < starts.length; i += 4) {
    const batch = await Promise.allSettled(
      starts.slice(i, i + 4).map(async start => parseMizuhoBack(await fetchRaw(MIZUHO_BACK + pageName(start), 1))),
    );
    for (const result of batch) {
      if (result.status !== 'fulfilled') continue;
      for (const row of result.value) map.set(row.round, {
        game,
        round: row.round,
        date: row.date,
        number: game === 'numbers3' ? row.n3 : row.n4,
        source: 'official',
      });
    }
  }
  return [...map.values()].sort((a, b) => b.round - a.round).slice(0, limit);
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

async function fetchRakutenHistory(game: Game, limit: number): Promise<Draw[]> {
  const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
  const months = monthKeys(Math.ceil(limit / 18) + 6);
  const map = new Map<number, Draw>();
  for (let i = 0; i < months.length && map.size < limit; i += 4) {
    const batch = await Promise.allSettled(
      months.slice(i, i + 4).map(async ym => parseRakuten(await fetchRaw(`${RAKUTEN_BASE}${slug}/${ym}/`, 1), game)),
    );
    for (const result of batch) {
      if (result.status !== 'fulfilled') continue;
      for (const row of result.value) map.set(row.round, row);
    }
  }
  return [...map.values()].sort((a, b) => b.round - a.round).slice(0, limit);
}

export async function fetchLatest(game: Game) {
  try {
    const parsed = parseMizuhoLatest(await fetchRaw(MIZUHO_LATEST[game], 1), game);
    if (parsed) return parsed;
  } catch {
    // VercelのIPが403拒否される場合があるため、楽天銀行へ切り替える。
  }
  const rows = await fetchRakutenHistory(game, 30);
  if (!rows.length) throw new Error('銀行サイトから最新結果を取得できませんでした');
  return rows[0];
}

export async function fetchOfficialHistory(game: Game, limit = 500): Promise<Draw[]> {
  let rows: Draw[] = [];
  try {
    rows = await fetchMizuhoHistory(game, limit);
  } catch {
    rows = await fetchRakutenHistory(game, limit);
  }
  if (rows.length < 60) throw new Error(`当せん履歴が不足しています（${rows.length}回）`);
  return rows;
}

export function nextDrawDate(japaneseDate: string) {
  const match = japaneseDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  do date.setUTCDate(date.getUTCDate() + 1); while ([0, 6].includes(date.getUTCDay()));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
