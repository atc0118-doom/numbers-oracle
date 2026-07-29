import type { Game, OracleCachePayload } from './types';
import { fetchOfficialHistory, nextDrawDate } from './official';
import { generate } from './predict';
import { evaluateAccuracy, selectProfile } from './accuracy';
import { evaluateAI, evaluateHybrid, generateAI, hybrid } from './ai';
import { evaluateRandom, generateRandom } from './random';
import { MODEL_VERSIONS, type ModelMode } from './models';
import { persistenceEnabled, saveForecast, saveOracleCache, settleForecasts } from './storage';

const HISTORY_ROWS_TO_FETCH = 80; // how many recent draws we keep in memory per sync (scrape volume is controlled in official.ts, not here)
const PICKS_PER_MODEL = 10;
const PICKS_FOR_HYBRID_INPUTS = 20; // hybrid blends the top-20 of each underlying model before taking the top 10

// Upper bound on how many historical draws we walk-forward backtest per sync.
// This only affects how much of the *already-fetched* history we replay —
// it does not trigger any additional scraping. Raised from 8 to 16 so the
// benchmark table isn't quite so thin, while still leaving enough leading
// history (60 draws) for each walk-forward test point to train on.
const MAX_BACKTEST_ROUNDS = 16;
const MIN_TRAINING_HISTORY_FOR_BACKTEST = 60;

function log(game: Game, stage: string, ...details: unknown[]) {
  console.info('[oracle][sync]', game, stage, ...details);
}

export async function syncGame(game: Game) {
  const warnings: string[] = [];
  if (!persistenceEnabled()) throw new Error('Supabase環境変数が未設定です');

  log(game, 'stage=history:start');
  const draws = await fetchOfficialHistory(game, HISTORY_ROWS_TO_FETCH);
  log(game, 'stage=history:ok', 'latest', draws[0]?.round, draws[0]?.number, draws[0]?.date, draws[0]?.source, 'rows', draws.length);

  let settledCount = 0;
  try {
    const result = await settleForecasts(draws);
    settledCount = result.settled;
    log(game, 'stage=settle:ok', settledCount);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    warnings.push(`settle:${message}`);
    console.error('[oracle][sync]', game, 'stage=settle:error', e);
  }

  log(game, 'stage=predict:start');
  const profile = selectProfile(game, draws);
  const statistical = generate(game, draws, PICKS_PER_MODEL, profile);
  const aiResult = generateAI(game, draws, PICKS_PER_MODEL);
  const hybridPredictions = hybrid(
    generate(game, draws, PICKS_FOR_HYBRID_INPUTS, profile),
    generateAI(game, draws, PICKS_FOR_HYBRID_INPUTS).predictions,
    PICKS_PER_MODEL,
  );
  const targetRound = draws[0].round + 1;
  const targetDate = await nextDrawDate(draws[0].date);
  const randomPredictions = generateRandom(game, targetRound, PICKS_PER_MODEL);
  log(game, 'stage=predict:ok', 'target', targetRound, targetDate);

  const predictionsByModel: Record<ModelMode, typeof statistical> = {
    statistical,
    ai: aiResult.predictions,
    hybrid: hybridPredictions,
    random: randomPredictions,
  };
  for (const model of ['statistical', 'ai', 'hybrid', 'random'] as ModelMode[]) {
    try {
      await saveForecast(game, targetRound, targetDate, model, MODEL_VERSIONS[model], predictionsByModel[model]);
      log(game, 'stage=forecast:ok', model, MODEL_VERSIONS[model]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`forecast:${model}:${message}`);
      console.error('[oracle][sync]', game, 'stage=forecast:error', model, e);
    }
  }

  log(game, 'stage=backtest:start');
  const benchmarkTests = Math.max(0, Math.min(MAX_BACKTEST_ROUNDS, draws.length - MIN_TRAINING_HISTORY_FOR_BACKTEST));
  const accuracy = {
    statistical: evaluateAccuracy(game, draws, PICKS_PER_MODEL, benchmarkTests),
    ai: evaluateAI(game, draws, PICKS_PER_MODEL, benchmarkTests),
    hybrid: evaluateHybrid(game, draws, PICKS_PER_MODEL, benchmarkTests),
    random: evaluateRandom(game, draws, PICKS_PER_MODEL, benchmarkTests),
  };
  const randomDigitMatchRate = accuracy.random.digitMatchRate || 0;
  const benchmark = {
    statisticalLift: Number((accuracy.statistical.digitMatchRate - randomDigitMatchRate).toFixed(1)),
    aiLift: Number((accuracy.ai.digitMatchRate - randomDigitMatchRate).toFixed(1)),
    hybridLift: Number((accuracy.hybrid.digitMatchRate - randomDigitMatchRate).toFixed(1)),
    note: '同じ対象回・同じ10口条件でRANDOM BASELINEとの差を比較。短期差は偶然の可能性が高く、公開後実績を優先して評価します。',
  };

  const payload: OracleCachePayload = {
    game,
    status: draws[0].source === 'public-fallback' ? 'public-verified' : 'bank-verified',
    latest: draws[0],
    targetRound,
    targetDate,
    predictions: { statistical, ai: aiResult.predictions, hybrid: hybridPredictions, random: randomPredictions },
    accuracy,
    benchmark,
    modelVersions: MODEL_VERSIONS,
    aiInfo: { model: aiResult.model, trainingRows: aiResult.trainingRows, features: '桁別頻度・未出間隔・直前数字・合計・奇偶・重複度' },
    sourceInfo: {
      primary: draws[0].source === 'public-fallback' ? '楽天銀行履歴 + 公開速報補完' : '楽天銀行 当せん番号案内',
      historySize: draws.length,
      latestSource: draws[0].source,
    },
    updatedAt: new Date().toISOString(),
    warnings,
    benchmarkTests,
    notice: 'V7はAI・統計・HYBRIDをRANDOM BASELINEと同条件で検証します。スコアは当せん確率ではありません。短期バックテストより、事前保存された公開後実績を重視してください。',
  };

  log(game, 'stage=cache:start');
  await saveOracleCache(game, payload);
  log(game, 'stage=cache:ok');

  return {
    latest: draws[0],
    targetRound,
    targetDate,
    settled: settledCount,
    cached: true,
    historySize: draws.length,
    warnings,
    modelVersions: MODEL_VERSIONS,
  };
}
