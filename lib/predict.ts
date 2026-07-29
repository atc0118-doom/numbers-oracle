import type { Draw, Game, Prediction, WeightProfile } from './types';

/**
 * FNV-1a based string hash. Used only to derive a reproducible seed
 * (game + profile + recent draw signature) for the pseudo-random
 * candidate generator below. Not cryptographic.
 */
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

export const PROFILES: WeightProfile[] = [
  { name: 'BALANCED', frequency: 0.52, overdue: 0.18, pair: 0.12, sum: 0.08, parity: 0.06, unique: 0.04 },
  { name: 'FREQUENCY', frequency: 0.72, overdue: 0.08, pair: 0.10, sum: 0.04, parity: 0.03, unique: 0.03 },
  { name: 'OVERDUE', frequency: 0.32, overdue: 0.42, pair: 0.10, sum: 0.06, parity: 0.05, unique: 0.05 },
  { name: 'PAIR', frequency: 0.38, overdue: 0.12, pair: 0.30, sum: 0.08, parity: 0.06, unique: 0.06 },
];

// Tuning constants pulled out of the scoring formula so they're named
// instead of bare numbers scattered through the code.
const HISTORY_WINDOW = 180;        // how many recent draws feed the frequency/overdue/pair stats
const SIGNATURE_DRAWS = 12;        // draws used to build the RNG seed signature
const OVERDUE_CAP = 20;            // "gaps since last seen" are capped at this many draws
const BASE_WEIGHT = 0.05;          // floor weight so every digit keeps some selection chance
const HIGH_ITERATIONS = 700;       // candidate-generation loop count when count >= 20
const LOW_ITERATIONS = 350;        // candidate-generation loop count otherwise
const FREQUENCY_SCORE_SCALE = 55;
const OVERDUE_SCORE_SCALE = 35;
const PAIR_SCORE_SCALE = 45;
const UNIQUE_DIGITS_BONUS = 25;
const SUM_IN_RANGE_BONUS = 30;
const MIXED_PARITY_BONUS = 30;
const SCORE_FLOOR = 35;
const SCORE_CEILING = 96;
const SCORE_BASE_OFFSET = 38;

/**
 * Generates `count` candidate numbers for a game, ranked by a heuristic
 * score built from three simple stats over the recent draw history:
 *  - per-position digit frequency
 *  - per-position "overdue" gap (draws since a digit last appeared there)
 *  - adjacent-position pair frequency
 * The `profile` argument controls how heavily each stat is weighted.
 *
 * This is a heuristic weighting scheme, not a claim about draw odds —
 * see README for the random-baseline comparison this is measured against.
 */
export function generate(
  game: Game,
  draws: Draw[],
  count = 20,
  profile: WeightProfile = PROFILES[0],
): Prediction[] {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const sample = draws.slice(0, Math.min(draws.length, HISTORY_WINDOW));

  // digitFrequency[position][digit] = how many times `digit` appeared at `position`
  const digitFrequency = Array.from({ length: digitCount }, () => Array(10).fill(0));
  // lastSeenIndex[position][digit] = index (0 = most recent) where `digit` last appeared at `position`
  const notSeenSentinel = sample.length + 5;
  const lastSeenIndex = Array.from({ length: digitCount }, () => Array(10).fill(notSeenSentinel));
  // pairFrequency[position][prevDigit][digit] = how often `digit` follows `prevDigit` at `position+1`
  const pairFrequency = Array.from({ length: Math.max(0, digitCount - 1) }, () =>
    Array.from({ length: 10 }, () => Array(10).fill(0)),
  );

  sample.forEach((draw, drawIndex) => {
    const digits = draw.number.split('');
    digits.forEach((digitChar, position) => {
      const digit = Number(digitChar);
      digitFrequency[position][digit]++;
      if (lastSeenIndex[position][digit] === notSeenSentinel) {
        lastSeenIndex[position][digit] = drawIndex;
      }
    });
    for (let position = 0; position < digitCount - 1; position++) {
      pairFrequency[position][Number(digits[position])][Number(digits[position + 1])]++;
    }
  });

  // Seed is derived only from inputs known before the draw (game, profile,
  // and recent history) so the same inputs always reproduce the same output.
  const signature = sample
    .slice(0, SIGNATURE_DRAWS)
    .map(d => `${d.round}:${d.number}`)
    .join('|');
  const random = createSeededRandom(hashString(`${game}-${profile.name}-${signature}`));

  const candidates = new Map<string, Prediction>();
  const maxFrequency = Math.max(1, ...digitFrequency.flat());
  const iterations = count >= 20 ? HIGH_ITERATIONS : LOW_ITERATIONS;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const number = pickWeightedNumber({
      digitCount,
      profile,
      digitFrequency,
      lastSeenIndex,
      pairFrequency,
      maxFrequency,
      random,
    });

    const score = scoreNumber(number, {
      digitCount,
      profile,
      digitFrequency,
      lastSeenIndex,
      pairFrequency,
      maxFrequency,
    });

    const existing = candidates.get(number.value);
    if (!existing || existing.score < score.score) {
      candidates.set(number.value, { number: number.value, score: score.score, relativeScore: score.score, reasons: score.reasons });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.number.localeCompare(b.number))
    .slice(0, count);
}

type StatsContext = {
  digitCount: number;
  profile: WeightProfile;
  digitFrequency: number[][];
  lastSeenIndex: number[][];
  pairFrequency: number[][][];
  maxFrequency: number;
};

/** Draws one candidate number digit-by-digit using weighted random selection. */
function pickWeightedNumber(ctx: StatsContext & { random: () => number }): { value: string } {
  const { digitCount, profile, digitFrequency, lastSeenIndex, pairFrequency, maxFrequency, random } = ctx;
  let value = '';
  for (let position = 0; position < digitCount; position++) {
    const previousDigit = position ? Number(value[position - 1]) : -1;
    const weights = Array.from({ length: 10 }, (_, digit) => {
      const frequencyWeight = digitFrequency[position][digit] / maxFrequency;
      const overdueWeight = Math.min(lastSeenIndex[position][digit], OVERDUE_CAP) / OVERDUE_CAP;
      const pairWeight = position
        ? pairFrequency[position - 1][previousDigit][digit] / Math.max(1, ...pairFrequency[position - 1][previousDigit])
        : 0;
      return BASE_WEIGHT + frequencyWeight * profile.frequency + overdueWeight * profile.overdue + pairWeight * profile.pair;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = random() * totalWeight;
    let picked = 0;
    for (let digit = 0; digit < 10; digit++) {
      roll -= weights[digit];
      if (roll <= 0) {
        picked = digit;
        break;
      }
    }
    value += picked;
  }
  return { value };
}

/** Scores a candidate number using the same stats used to generate it, plus shape bonuses. */
function scoreNumber(number: { value: string }, ctx: StatsContext): { score: number; reasons: string[] } {
  const { digitCount, profile, digitFrequency, lastSeenIndex, pairFrequency, maxFrequency } = ctx;
  const digits = [...number.value].map(Number);
  const uniqueDigitCount = new Set(number.value).size;
  const sum = digits.reduce((a, b) => a + b, 0);
  const oddCount = digits.filter(n => n % 2 === 1).length;
  const sumMidpointRange = digitCount === 3 ? [9, 20] : [12, 25];

  let raw = 0;
  digits.forEach((digit, position) => {
    raw += (digitFrequency[position][digit] / maxFrequency) * profile.frequency * FREQUENCY_SCORE_SCALE;
    raw += (Math.min(lastSeenIndex[position][digit], OVERDUE_CAP) / OVERDUE_CAP) * profile.overdue * OVERDUE_SCORE_SCALE;
    if (position > 0) {
      const previousDigit = digits[position - 1];
      const denom = Math.max(1, ...pairFrequency[position - 1][previousDigit]);
      raw += (pairFrequency[position - 1][previousDigit][digit] / denom) * profile.pair * PAIR_SCORE_SCALE;
    }
  });

  const reasons: string[] = [];
  if (uniqueDigitCount === digitCount) {
    raw += profile.unique * UNIQUE_DIGITS_BONUS;
    reasons.push('全桁異数字');
  } else {
    reasons.push('重複数字を含む');
  }
  if (sum >= sumMidpointRange[0] && sum <= sumMidpointRange[1]) {
    raw += profile.sum * SUM_IN_RANGE_BONUS;
    reasons.push('合計値が中心帯');
  }
  if (oddCount > 0 && oddCount < digitCount) {
    raw += profile.parity * MIXED_PARITY_BONUS;
    reasons.push('奇数・偶数混合');
  }
  reasons.push(`${profile.name}重みで自動評価`);

  const score = Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, Math.round(SCORE_BASE_OFFSET + raw / (digitCount * 0.72))));
  return { score, reasons };
}
