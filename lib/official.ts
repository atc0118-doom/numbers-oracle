import type { Draw, Game } from './types';

const URLS: Record<Game, string> = {
  numbers3: 'https://www.mizuhobank.co.jp/takarakuji/check/numbers/numbers3/index.html',
  numbers4: 'https://www.mizuhobank.co.jp/takarakuji/check/numbers/numbers4/index.html'
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

export async function fetchLatest(game: Game): Promise<Draw | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(URLS[game], {
    headers: { 'user-agent': 'Mozilla/5.0 NumbersOracle/1.1' },
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`official fetch failed: ${res.status}`);

  const text = htmlToText(await res.text());
  const digits = game === 'numbers3' ? 3 : 4;
  const round = text.match(/第\s*(\d+)\s*回/)?.[1];
  const date = text.match(/抽せん日\s*(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1];
  const number = text.match(new RegExp(`抽せん数字\\s*(\\d{${digits}})`))?.[1];

  if (!round || !date || !number) return null;
  return { game, round: Number(round), date, number, source: 'official' };
}
