import type { AccuracyStats, Draw, Game, WeightProfile } from './types';
export type { AccuracyStats } from './types';
import { generate, PROFILES } from './predict';

const boxKey = (value: string) => [...value].sort().join('');

const QUICK_SCORE_MAX_ROUNDS = 24;
const QUICK_SCORE_STEP = 4; // sample every 4th round to keep profile selection cheap
const QUICK_SCORE_STRAIGHT_POINTS = 6;
const QUICK_SCORE_BOX_POINTS = 2;
const QUICK_SCORE_DIGIT_MATCH_WEIGHT = 0.15;

/** Cheap approximate score used only to pick which WeightProfile to use, not for reporting accuracy. */
function quickScore(game: Game, draws: Draw[], profile: WeightProfile): number {
  let totalScore = 0;
  let tested = 0;
  const limit = Math.min(QUICK_SCORE_MAX_ROUNDS, draws.length - 20);

  for (let i = 0; i < limit; i += QUICK_SCORE_STEP) {
    const target = draws[i];
    const trainingData = draws.slice(i + 1);
    const predictedNumbers = generate(game, trainingData, 10, profile).map(p => p.number);

    if (predictedNumbers.includes(target.number)) totalScore += QUICK_SCORE_STRAIGHT_POINTS;
    else if (predictedNumbers.some(v => boxKey(v) === boxKey(target.number))) totalScore += QUICK_SCORE_BOX_POINTS;

    totalScore += predictedNumbers.reduce(
      (best, v) => Math.max(best, [...v].filter((c, j) => c === target.number[j]).length),
      0,
    ) * QUICK_SCORE_DIGIT_MATCH_WEIGHT;
    tested++;
  }
  return tested ? totalScore / tested : 0;
}

/** Picks the best-scoring WeightProfile for this game, given only the draws passed in (so this can be called with training-only data during backtests). */
export function selectProfile(game: Game, draws: Draw[]): WeightProfile {
  return [...PROFILES].sort((a, b) => quickScore(game, draws, b) - quickScore(game, draws, a))[0];
}

const MIN_TRAINING_HISTORY = 30;

/** Fair walk-forward evaluation: profile selection is repeated using training data only, for each historical test point. */
export function evaluateAccuracy(game: Game, draws: Draw[], picksPerDraw = 10, testLimit = 12): AccuracyStats {
  let tested = 0, straightHits = 0, boxHits = 0, digitsMatched = 0, digitsTotal = 0;
  const maxTests = Math.min(testLimit, draws.length - MIN_TRAINING_HISTORY);

  for (let i = 0; i < maxTests; i++) {
    const target = draws[i];
    const trainingData = draws.slice(i + 1);
    if (trainingData.length < MIN_TRAINING_HISTORY) continue;

    const profile = selectProfile(game, trainingData);
    const predictedNumbers = generate(game, trainingData, picksPerDraw, profile).map(p => p.number);

    tested++;
    if (predictedNumbers.includes(target.number)) straightHits++;
    if (predictedNumbers.some(v => boxKey(v) === boxKey(target.number))) boxHits++;
    digitsMatched += predictedNumbers.reduce(
      (best, v) => Math.max(best, [...v].filter((c, j) => c === target.number[j]).length),
      0,
    );
    digitsTotal += target.number.length;
  }

  const rate = (n: number) => (tested ? Number(((n / tested) * 100).toFixed(2)) : 0);

  // NOTE: Draw['source'] is one of 'bank-fallback' | 'public-fallback' | 'cache' — official.ts
  // never tags a row 'official' directly, it just uses those as the two live-scrape sources.
  // Both count as "official" data quality here; only a 'cache'-only history (couldn't confirm
  // against either live source) would be marked 'reference'.
  const dataQuality: AccuracyStats['dataQuality'] = draws.every(
    d => d.source === 'bank-fallback' || d.source === 'public-fallback',
  )
    ? 'official'
    : 'reference';

  return {
    testedDraws: tested,
    picksPerDraw,
    straightHits,
    boxHits,
    straightRate: rate(straightHits),
    boxRate: rate(boxHits),
    digitMatchRate: digitsTotal ? Number(((digitsMatched / digitsTotal) * 100).toFixed(1)) : 0,
    dataQuality,
    selectedProfile: 'WALK-FORWARD SELECT',
    historySize: draws.length,
  };
}
