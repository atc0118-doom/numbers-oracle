import type { Game, Prediction, Draw } from './types';

/** FNV-1a string hash, used only to derive a reproducible RNG seed. Not cryptographic. */
function hashString(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG. Deterministic given the same seed. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASELINE_SCORE = 50; // fixed score for every RANDOM pick — it never claims to rank picks by likelihood

/**
 * Reproducible random benchmark. The seed uses only game + target round,
 * which are known before the draw. It never uses the winning number/history,
 * so it's a fair "no information" baseline to compare the other models against.
 */
export function generateRandom(game: Game, targetRound: number, count = 10): Prediction[] {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const maxValue = 10 ** digitCount;
  const random = createSeededRandom(hashString(`NUMBERS_ORACLE_RANDOM_7:${game}:${targetRound}`));

  const chosenNumbers = new Set<number>();
  while (chosenNumbers.size < Math.min(count, maxValue)) {
    chosenNumbers.add(Math.floor(random() * maxValue));
  }

  return [...chosenNumbers].map((n, index) => ({
    number: String(n).padStart(digitCount, '0'),
    score: BASELINE_SCORE,
    relativeScore: 100 - index,
    reasons: ['RANDOM BASELINE', '対象回のみを種にした再現可能な擬似乱数', '当せん履歴は不使用'],
  }));
}

export const RANDOM_SELECTION_VARIANTS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'] as const;
export type RandomVariant = (typeof RANDOM_SELECTION_VARIANTS)[number];

/**
 * Same as generateRandom, but seeds on an extra `variant` salt. Still never
 * uses draw history to build the numbers — only the label changes the seed.
 *
 * This exists purely as a bias-control tool: STATISTICAL/HYBRID pick the
 * best-scoring of 4 weight profiles after looking at recent history
 * (selectProfile in accuracy.ts). Any selection-among-N-options process adds
 * an apparent edge even with zero real signal, just from picking the winner
 * in hindsight. To measure how big that effect is on its own, accuracy.ts
 * puts these 4 plain-random variants through the identical best-of-4
 * selection process (selectRandomVariant / evaluateSelectionBias) and
 * compares the result to plain RANDOM. Whatever "lift" shows up there is
 * pure selection bias, not skill — and should be subtracted from
 * STATISTICAL/HYBRID's apparent lift before treating it as evidence.
 */
export function generateRandomVariant(
  game: Game,
  targetRound: number,
  variant: RandomVariant,
  count = 10,
): Prediction[] {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const maxValue = 10 ** digitCount;
  const random = createSeededRandom(hashString(`NUMBERS_ORACLE_RANDOM_7:${game}:${targetRound}:${variant}`));

  const chosenNumbers = new Set<number>();
  while (chosenNumbers.size < Math.min(count, maxValue)) {
    chosenNumbers.add(Math.floor(random() * maxValue));
  }

  return [...chosenNumbers].map((n, index) => ({
    number: String(n).padStart(digitCount, '0'),
    score: BASELINE_SCORE,
    relativeScore: 100 - index,
    reasons: ['RANDOM BASELINE', `selection-bias control variant ${variant}`],
  }));
}

const boxKey = (value: string) => [...value].sort().join('');

/** Backtests the RANDOM baseline the same way the other models are backtested, for apples-to-apples comparison. */
export function evaluateRandom(game: Game, draws: Draw[], picks = 10, maxTests = 12) {
  let tested = 0, straightHits = 0, boxHits = 0, digitsMatched = 0, digitsTotal = 0;
  const limit = Math.min(maxTests, draws.length);

  for (let i = 0; i < limit; i++) {
    const target = draws[i];
    const predictedNumbers = generateRandom(game, target.round, picks).map(p => p.number);

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
  return {
    testedDraws: tested,
    picksPerDraw: picks,
    straightHits,
    boxHits,
    straightRate: rate(straightHits),
    boxRate: rate(boxHits),
    digitMatchRate: digitsTotal ? Number(((digitsMatched / digitsTotal) * 100).toFixed(1)) : 0,
  };
}
