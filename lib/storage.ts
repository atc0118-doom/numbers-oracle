import type { Draw, Game, OracleCachePayload, Prediction } from './types';
import type { ModelMode } from './models';
export type { ModelMode } from './models';

export type SavedForecast = {
  id?: string;
  game: Game;
  target_round: number;
  target_date: string | null;
  model: ModelMode;
  model_version: string;
  picks: string[];
  scores: number[];
  purchase_type?: 'straight';
  stake_yen?: number;
  return_yen?: number | null;
  roi_percent?: number | null;
  created_at?: string;
  settled_at?: string | null;
  winning_number?: string | null;
  straight_hit?: boolean | null;
  box_hit?: boolean | null;
  best_digit_match?: number | null;
  status?: 'pending' | 'settled';
};

export type OracleCacheRow = { game: Game; payload: OracleCachePayload; updated_at?: string };

const SUPABASE_REQUEST_TIMEOUT_MS = 12000;
const STAKE_YEN_PER_PICK = 200; // assumed per-pick stake used only to compute illustrative ROI

/** Reads Supabase connection config from env. Supports both the legacy service_role JWT and the newer sb_secret_ key formats. */
function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return { enabled: Boolean(url && key), url, key };
}

export function persistenceEnabled() {
  return supabaseConfig().enabled;
}

/**
 * Thin wrapper around Supabase's PostgREST API.
 * Legacy `service_role` keys are JWTs (start with "eyJ") and need an
 * `Authorization: Bearer` header in addition to `apikey`. The newer
 * `sb_secret_...` keys are sent via `apikey` only (see README V7.1 fix).
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = supabaseConfig();
  if (!config.enabled) throw new Error('Supabase persistence is not configured');

  const headers = new Headers(init.headers);
  headers.set('apikey', config.key);
  if (config.key.startsWith('eyJ')) {
    headers.set('Authorization', `Bearer ${config.key}`);
  } else {
    headers.delete('Authorization');
  }
  headers.set('Content-Type', 'application/json');
  if (!headers.has('Prefer')) headers.set('Prefer', 'return=representation');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      console.error('[oracle][supabase]', init.method ?? 'GET', path, response.status, text.slice(0, 1200));
      throw new Error(`SUPABASE_${response.status}:${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    console.error('[oracle][supabase-request]', init.method ?? 'GET', path, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Saves a forecast for a not-yet-drawn round. Upserts on (game, target_round, model, model_version) so re-running a cron is idempotent. */
export async function saveForecast(
  game: Game,
  targetRound: number,
  targetDate: string | null,
  model: ModelMode,
  modelVersion: string,
  predictions: Prediction[],
) {
  if (!persistenceEnabled()) return null;
  const payload = {
    game,
    target_round: targetRound,
    target_date: targetDate,
    model,
    model_version: modelVersion,
    picks: predictions.map(p => p.number),
    scores: predictions.map(p => (Number.isFinite(p.score) ? p.score : 0)),
    purchase_type: 'straight',
    stake_yen: predictions.length * STAKE_YEN_PER_PICK,
    status: 'pending',
  };
  const rows = await request<SavedForecast[]>('forecasts?on_conflict=game,target_round,model,model_version', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0] ?? null;
}

const boxKey = (value: string) => [...value].sort().join('');

/** Compares a saved set of picks against the actual winning number. */
export function settleValues(picks: string[], winning: string) {
  const straightHit = picks.includes(winning);
  const boxHit = picks.some(v => boxKey(v) === boxKey(winning));
  const bestDigitMatch = picks.reduce(
    (best, v) => Math.max(best, [...v].filter((c, i) => c === winning[i]).length),
    0,
  );
  return { straight_hit: straightHit, box_hit: boxHit, best_digit_match: bestDigitMatch };
}

/** Settles every still-pending forecast for a game against the freshly fetched draw history. */
export async function settleForecasts(draws: Draw[]) {
  if (!persistenceEnabled()) return { settled: 0 };
  const game = draws[0]?.game;
  if (!game) return { settled: 0 };

  const pendingForecasts = await request<SavedForecast[]>(`forecasts?game=eq.${game}&status=eq.pending&select=*`);
  const drawByRound = new Map(draws.map(d => [d.round, d]));

  let settledCount = 0;
  for (const forecast of pendingForecasts) {
    const draw = drawByRound.get(forecast.target_round);
    if (!draw || !forecast.id) continue;

    const result = settleValues(forecast.picks, draw.number);
    const payout = result.straight_hit ? (draw.payouts?.straight ?? null) : 0;
    const stake = forecast.stake_yen ?? forecast.picks.length * STAKE_YEN_PER_PICK;
    const roi = payout === null ? null : Number((((payout - stake) / stake) * 100).toFixed(2));

    await request(`forecasts?id=eq.${encodeURIComponent(forecast.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...result,
        winning_number: draw.number,
        return_yen: payout,
        roi_percent: roi,
        status: 'settled',
        settled_at: new Date().toISOString(),
      }),
    });
    settledCount++;
  }
  return { settled: settledCount };
}

export async function getForecasts(game: Game, limit = 240) {
  if (!persistenceEnabled()) return [] as SavedForecast[];
  return request<SavedForecast[]>(`forecasts?game=eq.${game}&select=*&order=target_round.desc,model.asc&limit=${limit}`);
}

/** Aggregates one model's settled forecasts into hit rates + illustrative ROI. */
function summarizeGroup(model: ModelMode, modelVersion: string, items: SavedForecast[]) {
  const count = items.length;
  const stakeYen = items.reduce((sum, r) => sum + (r.stake_yen ?? 0), 0);
  const returnYen = items.reduce((sum, r) => sum + (r.return_yen ?? 0), 0);
  const returnIsKnown = items.some(r => r.return_yen !== null && r.return_yen !== undefined);
  const straightHits = items.filter(r => r.straight_hit).length;
  const boxHits = items.filter(r => r.box_hit).length;

  return {
    model,
    modelVersion,
    draws: count,
    straightHits,
    boxHits,
    straightRate: count ? Number(((straightHits / count) * 100).toFixed(2)) : 0,
    boxRate: count ? Number(((boxHits / count) * 100).toFixed(2)) : 0,
    avgDigitMatch: count ? Number((items.reduce((sum, r) => sum + (r.best_digit_match ?? 0), 0) / count).toFixed(3)) : 0,
    stakeYen,
    returnYen: returnIsKnown ? returnYen : null,
    roiPercent: returnIsKnown && stakeYen ? Number((((returnYen - stakeYen) / stakeYen) * 100).toFixed(2)) : null,
  };
}

/**
 * Builds the "public track record" view shown on the 公開実績 tab:
 * per-model summaries for the *current* model version, a full version
 * history (so old model iterations aren't silently mixed with new ones),
 * and a paired head-to-head against RANDOM restricted to rounds where
 * both a model's and RANDOM's forecasts have already settled.
 */
export function summarizeLive(rows: SavedForecast[], currentVersions: Record<ModelMode, string>) {
  const settled = rows.filter(r => r.status === 'settled');
  const modes: ModelMode[] = ['hybrid', 'ai', 'statistical', 'random'];

  const byModel = modes.map(model =>
    summarizeGroup(model, currentVersions[model], settled.filter(r => r.model === model && r.model_version === currentVersions[model])),
  );

  const groupsByVersion = new Map<string, SavedForecast[]>();
  for (const row of settled) {
    const key = `${row.model}::${row.model_version ?? 'LEGACY'}`;
    const group = groupsByVersion.get(key) ?? [];
    group.push(row);
    groupsByVersion.set(key, group);
  }
  const byVersion = [...groupsByVersion.entries()]
    .map(([key, items]) => {
      const [model, version] = key.split('::');
      return summarizeGroup(model as ModelMode, version, items);
    })
    .sort((a, b) => b.draws - a.draws);

  const randomVersion = currentVersions.random;
  const randomRowsByRound = new Map(
    settled.filter(r => r.model === 'random' && r.model_version === randomVersion).map(r => [r.target_round, r]),
  );

  const benchmark = modes
    .filter(model => model !== 'random')
    .map(model => {
      const modelRows = settled.filter(
        r => r.model === model && r.model_version === currentVersions[model] && randomRowsByRound.has(r.target_round),
      );
      const pairs = modelRows.map(modelRow => ({ model: modelRow, random: randomRowsByRound.get(modelRow.target_round)! }));
      const n = pairs.length;
      const modelAvg = n ? pairs.reduce((sum, p) => sum + (p.model.best_digit_match ?? 0), 0) / n : 0;
      const randomAvg = n ? pairs.reduce((sum, p) => sum + (p.random.best_digit_match ?? 0), 0) / n : 0;

      return {
        model,
        modelVersion: currentVersions[model],
        pairedDraws: n,
        avgDigitMatch: Number(modelAvg.toFixed(3)),
        randomAvgDigitMatch: Number(randomAvg.toFixed(3)),
        digitLift: Number((modelAvg - randomAvg).toFixed(3)),
        straightDelta: pairs.filter(p => p.model.straight_hit).length - pairs.filter(p => p.random.straight_hit).length,
        boxDelta: pairs.filter(p => p.model.box_hit).length - pairs.filter(p => p.random.box_hit).length,
      };
    });

  return {
    startedAt: rows.length ? [...rows].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0].created_at : null,
    totalSettled: settled.length,
    byModel,
    byVersion,
    benchmark,
  };
}

export async function saveOracleCache(game: Game, payload: OracleCachePayload) {
  if (!persistenceEnabled()) throw new Error('Supabase cache is not configured');
  const rows = await request<OracleCacheRow[]>('oracle_cache?on_conflict=game', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ game, payload, updated_at: new Date().toISOString() }),
  });
  return rows?.[0] ?? null;
}

export async function getOracleCache(game: Game) {
  if (!persistenceEnabled()) return null;
  const rows = await request<OracleCacheRow[]>(`oracle_cache?game=eq.${game}&select=game,payload,updated_at&limit=1`);
  return rows?.[0] ?? null;
}
