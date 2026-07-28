import type { Draw, Game } from './types';

const RAKUTEN_BASE = 'https://takarakuji.rakuten.co.jp/backnumber/bank/';
const LOTO_LIFE: Record<Game,string> = {
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
        'user-agent': 'Mozilla/5.0 (compatible; NumbersOracle/6.5; +https://vercel.app)',
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
function weekdayPrev(iso: string) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  do dt.setUTCDate(dt.getUTCDate()-1); while ([0,6].includes(dt.getUTCDay()));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}
function jstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date());
  const get=(t:string)=>parts.find(p=>p.type===t)?.value??'';
  return {iso:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour')),minute:Number(get('minute'))};
}
/** 公式案内では数字選択式の最新結果は原則20:30すぎに照会可能。 */
export function expectedLatestDrawDate() {
  const now=jstNow();
  const [y,m,d]=now.iso.split('-').map(Number);
  const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
  if([0,6].includes(weekday)) return weekdayPrev(now.iso);
  if(now.hour*60+now.minute < 20*60+30) return weekdayPrev(now.iso);
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
async function fetchPublicLatest(game: Game): Promise<Draw|null> {
  try {
    const text=clean(await fetchRaw(LOTO_LIFE[game],4500));
    const digits=game==='numbers3'?3:4;
    const re=new RegExp(`回別\\s*第(\\d+)回[\\s\\S]{0,100}?抽選日\\s*(\\d{4})年(\\d{1,2})月(\\d{1,2})日[\\s\\S]{0,100}?当選番号\\s*(\\d{${digits}})[\\s\\S]{0,160}?ストレート\\s*(?:[\\d,，]+口\\s*)?([\\d,，]+)円[\\s\\S]{0,120}?ボックス\\s*(?:[\\d,，]+口\\s*)?([\\d,，]+)円`);
    const m=text.match(re);
    if(!m) return null;
    return {
      game,round:Number(m[1]),date:`${m[2]}年${Number(m[3])}月${Number(m[4])}日`,number:m[5],source:'public-fallback',
      payouts:{straight:yen(m[6]),box:yen(m[7])}
    };
  } catch(e) {
    console.warn('[oracle] latest supplement unavailable', game, e instanceof Error?e.message:String(e));
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

export async function fetchOfficialHistory(game: Game, limit = 70): Promise<Draw[]> {
  const slug = game === 'numbers3' ? 'numbers3' : 'numbers4';
  const months = monthKeys(4);
  const [latest, ...history] = await Promise.allSettled([
    fetchPublicLatest(game),
    ...months.map(async ym => parseRakuten(await fetchRaw(`${RAKUTEN_BASE}${slug}/${ym}/`), game)),
  ]);
  const map = new Map<number,Draw>();
  for(const result of history){
    if(result.status!=='fulfilled') continue;
    for(const row of result.value) map.set(row.round,row);
  }
  if(latest.status==='fulfilled' && latest.value){
    const existing=map.get(latest.value.round);
    map.set(latest.value.round,{...existing,...latest.value,payouts:latest.value.payouts??existing?.payouts});
  }
  const rows=[...map.values()].sort((a,b)=>b.round-a.round).slice(0,limit);
  if(rows.length<50) throw new Error(`HISTORY_SHORT:${rows.length}`);
  const latestIso=parseIsoDate(rows[0].date);
  const expected=expectedLatestDrawDate();
  if(!latestIso || latestIso<expected) throw new Error(`SOURCE_STALE:${latestIso??'unknown'}:${expected}`);
  return rows;
}

export async function fetchLatest(game: Game) { return (await fetchOfficialHistory(game,30))[0]; }
export function nextDrawDate(japaneseDate: string) {
  const iso=parseIsoDate(japaneseDate);
  return iso?weekdayNext(iso):null;
}
