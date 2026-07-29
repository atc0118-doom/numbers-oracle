import type { Draw, Game, Prediction } from './types';
import { generate } from './predict';
import { selectProfile } from './accuracy';

/** Converts raw class scores into a probability distribution. */
function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exponentials = values.map(v => Math.exp(v - max));
  const sum = exponentials.reduce((a, b) => a + b, 0) || 1;
  return exponentials.map(v => v / sum);
}

/** Dot product of two equal-length (or b-longer) numeric vectors. */
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
}

const FEATURE_HISTORY_WINDOW = 80; // how many recent draws feed the feature vector
const OVERDUE_CAP = 30;            // "gap since last seen" is capped at this many draws

/**
 * Builds the feature vector for one prediction point, using only draws
 * strictly before it (the caller passes `history` already sliced/ordered
 * so index 0 is "most recent before this point").
 *
 * Features per digit position: bias term, per-digit frequency (10),
 * per-digit overdue gap (10), one-hot of the immediately preceding draw's
 * digit (10). Plus three global features: previous draw's digit sum,
 * odd-digit ratio, and unique-digit ratio.
 */
function buildFeatureVector(history: Draw[], game: Game): number[] {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const sample = history.slice(0, Math.min(FEATURE_HISTORY_WINDOW, history.length));
  const features: number[] = [1]; // bias term

  for (let position = 0; position < digitCount; position++) {
    const frequency = Array(10).fill(0);
    const lastSeen = Array(10).fill(sample.length);
    sample.forEach((draw, index) => {
      const digit = Number(draw.number[position]);
      frequency[digit]++;
      if (lastSeen[digit] === sample.length) lastSeen[digit] = index;
    });
    for (let digit = 0; digit < 10; digit++) features.push(frequency[digit] / Math.max(1, sample.length));
    for (let digit = 0; digit < 10; digit++) features.push(Math.min(lastSeen[digit], OVERDUE_CAP) / OVERDUE_CAP);

    const previousDigit = history[0]?.number[position];
    for (let digit = 0; digit < 10; digit++) features.push(Number(previousDigit) === digit ? 1 : 0);
  }

  const previousDigits = history[0]?.number.split('').map(Number) ?? Array(digitCount).fill(0);
  const sum = previousDigits.reduce((a, b) => a + b, 0);
  features.push(
    sum / (9 * digitCount),
    previousDigits.filter(n => n % 2 === 1).length / digitCount,
    new Set(previousDigits).size / digitCount,
  );
  return features;
}

const MIN_TRAINING_HISTORY = 24; // need at least this many prior draws before the first training row
const MAX_TRAINING_ROWS = 300;   // cap on how many (feature, label) rows we train on

/**
 * Builds walk-forward training rows: for each draw (after enough prior
 * history exists), the label is that draw's digits and the features are
 * computed only from draws strictly before it. This avoids leaking future
 * information into the features.
 */
function buildTrainingRows(draws: Draw[], game: Game, maxRows = MAX_TRAINING_ROWS) {
  const chronological = [...draws].sort((a, b) => a.round - b.round);
  const rows: { features: number[]; label: number[] }[] = [];
  for (let i = MIN_TRAINING_HISTORY; i < chronological.length; i++) {
    const priorDrawsMostRecentFirst = chronological.slice(0, i).reverse();
    rows.push({
      features: buildFeatureVector(priorDrawsMostRecentFirst, game),
      label: chronological[i].number.split('').map(Number),
    });
  }
  return rows.slice(-maxRows);
}

const LEARNING_RATE = 0.16;
const L2_REGULARIZATION = 0.0015;
const EPOCHS = 45;
const LEARNING_RATE_DECAY_FACTOR = 1.35; // rate decays toward 0 by epoch (EPOCHS * this factor)

/**
 * Trains one multiclass logistic regression per digit position (10 classes
 * each, digits 0-9), using plain SGD with L2 weight decay and a linearly
 * decaying learning rate.
 */
function trainModel(draws: Draw[], game: Game) {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const rows = buildTrainingRows(draws, game);
  const featureDim = rows[0]?.features.length ?? (1 + digitCount * 30 + 3);
  const weights = Array.from({ length: digitCount }, () =>
    Array.from({ length: 10 }, () => Array(featureDim).fill(0)),
  );

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const rate = LEARNING_RATE * (1 - epoch / (EPOCHS * LEARNING_RATE_DECAY_FACTOR));
    for (const row of rows) {
      for (let position = 0; position < digitCount; position++) {
        const classProbabilities = softmax(weights[position].map(w => dotProduct(w, row.features)));
        for (let digitClass = 0; digitClass < 10; digitClass++) {
          const target = digitClass === row.label[position] ? 1 : 0;
          const error = target - classProbabilities[digitClass];
          for (let j = 0; j < featureDim; j++) {
            weights[position][digitClass][j] +=
              rate * (error * row.features[j] - L2_REGULARIZATION * weights[position][digitClass][j]);
          }
        }
      }
    }
  }
  return { weights, trainingRowCount: rows.length };
}

const BEAM_WIDTH_MULTIPLIER = 8;
const BEAM_WIDTH_MIN = 60;
const SCORE_MIN = 55;
const SCORE_RANGE = 40;
const SCORE_FLOOR = 35;
const SCORE_CEILING = 95;

/**
 * Trains a fresh model on `draws` and generates `count` candidate numbers
 * via beam search over the per-position digit probability distributions.
 */
export function generateAI(
  game: Game,
  draws: Draw[],
  count = 10,
): { predictions: Prediction[]; trainingRows: number; model: string } {
  const digitCount = game === 'numbers3' ? 3 : 4;
  const { weights, trainingRowCount } = trainModel(draws, game);
  const features = buildFeatureVector(draws, game);
  const digitProbabilities = weights.map(classWeights => softmax(classWeights.map(w => dotProduct(w, features))));

  type BeamItem = { number: string; logProbability: number; digitProbabilities: number[] };
  let beam: BeamItem[] = [{ number: '', logProbability: 0, digitProbabilities: [] }];
  const beamWidth = Math.max(count * BEAM_WIDTH_MULTIPLIER, BEAM_WIDTH_MIN);

  for (let position = 0; position < digitCount; position++) {
    const next: BeamItem[] = [];
    for (const item of beam) {
      for (let digit = 0; digit < 10; digit++) {
        next.push({
          number: item.number + digit,
          logProbability: item.logProbability + Math.log(Math.max(digitProbabilities[position][digit], 1e-9)),
          digitProbabilities: [...item.digitProbabilities, digitProbabilities[position][digit]],
        });
      }
    }
    beam = next.sort((a, b) => b.logProbability - a.logProbability).slice(0, beamWidth);
  }

  const maxLogProbability = beam[0]?.logProbability ?? 0;
  const minLogProbability = beam[Math.min(beam.length - 1, count * 5)]?.logProbability ?? maxLogProbability - 1;

  const predictions = beam.slice(0, count).map((item, index) => {
    const normalizedScore = (item.logProbability - minLogProbability) / Math.max(0.0001, maxLogProbability - minLogProbability);
    const score = Math.round(SCORE_MIN + SCORE_RANGE * normalizedScore);
    const averageConfidence = (item.digitProbabilities.reduce((a, b) => a + b, 0) / digitCount * 100).toFixed(1);
    return {
      number: item.number,
      score: Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, score)),
      relativeScore: 100 - index,
      reasons: [`多クラスロジスティック回帰`, `${trainingRowCount}学習行`, `平均桁確信度 ${averageConfidence}%`],
    };
  });

  return { predictions, trainingRows: trainingRowCount, model: 'MULTINOMIAL LOGISTIC' };
}

const boxKey = (value: string) => [...value].sort().join('');

/**
 * Walk-forward backtest: for each of the most recent `maxTests` draws,
 * retrain using only the draws that came after it chronologically (i.e.
 * were known at that point) and check whether the predictions would have
 * matched.
 */
export function evaluateAI(game: Game, draws: Draw[], picks = 10, maxTests = 12) {
  let tested = 0, straightHits = 0, boxHits = 0, digitsMatched = 0, digitsTotal = 0;
  const limit = Math.min(maxTests, draws.length - 50);

  for (let i = 0; i < limit; i++) {
    const target = draws[i];
    const trainingData = draws.slice(i + 1);
    if (trainingData.length < 50) continue;

    const predictedNumbers = generateAI(game, trainingData, picks).predictions.map(p => p.number);
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

const STAT_WEIGHT = 0.45;
const AI_WEIGHT = 0.55;
const RANK_SCORE_STEP = 2; // how much each rank position below #1 loses in the blended ranking score

/**
 * Blends statistical and AI predictions into a single ranked list. Numbers
 * appearing in both lists get contributions from both; numbers appearing
 * in only one get a zero contribution from the other.
 */
export function hybrid(stat: Prediction[], ai: Prediction[], count = 10): Prediction[] {
  const combined = new Map<string, { statRank: number; aiRank: number; reasons: string[] }>();

  stat.forEach((p, i) => combined.set(p.number, { statRank: 100 - i * RANK_SCORE_STEP, aiRank: 0, reasons: ['統計モデル上位'] }));
  ai.forEach((p, i) => {
    const current = combined.get(p.number) ?? { statRank: 0, aiRank: 0, reasons: [] };
    current.aiRank = 100 - i * RANK_SCORE_STEP;
    current.reasons.push('AIモデル上位');
    combined.set(p.number, current);
  });

  return [...combined.entries()]
    .map(([number, v]) => {
      const blendedScore = v.statRank * STAT_WEIGHT + v.aiRank * AI_WEIGHT;
      return {
        number,
        score: Math.round(35 + blendedScore * 0.6),
        relativeScore: Math.round(blendedScore),
        reasons: [...v.reasons, '統計45% + AI55%'],
      };
    })
    .sort((a, b) => b.relativeScore - a.relativeScore)
    .slice(0, count);
}

/** Hybrid backtest uses the same statistical profile selection + AI model as live prediction. */
export function evaluateHybrid(game: Game, draws: Draw[], picks = 10, maxTests = 12) {
  let tested = 0, straightHits = 0, boxHits = 0, digitsMatched = 0, digitsTotal = 0;
  const limit = Math.min(maxTests, draws.length - 60);

  for (let i = 0; i < limit; i++) {
    const target = draws[i];
    const trainingData = draws.slice(i + 1);
    if (trainingData.length < 60) continue;

    const profile = selectProfile(game, trainingData);
    const statPredictions = generate(game, trainingData, 20, profile);
    const aiPredictions = generateAI(game, trainingData, 20).predictions;
    const predictedNumbers = hybrid(statPredictions, aiPredictions, picks).map(p => p.number);

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
