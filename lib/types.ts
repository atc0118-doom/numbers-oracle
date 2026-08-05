import type { ModelMode } from './models';

export type Game = 'numbers3' | 'numbers4';

export type Draw = {
  game: Game;
  round: number;
  date: string;
  number: string;
  source: 'official' | 'bank-fallback' | 'public-fallback' | 'cache';
  payouts?: { straight?: number | null; box?: number | null };
};

export type WeightProfile = {
  name: string;
  frequency: number;
  overdue: number;
  pair: number;
  sum: number;
  parity: number;
  unique: number;
};

export type Prediction = { number: string; score: number; relativeScore: number; reasons: string[] };

/** Straight/box/digit-match backtest result shape shared by all four models. */
export type BacktestResult = {
  testedDraws: number;
  picksPerDraw: number;
  straightHits: number;
  boxHits: number;
  straightRate: number;
  boxRate: number;
  digitMatchRate: number;
};

/** Backtest result for the statistical model, which additionally reports which weight profile was selected and how trustworthy the source history is. */
export type AccuracyStats = BacktestResult & {
  dataQuality: 'official' | 'reference';
  selectedProfile: string;
  historySize: number;
};

/** Cached payload written by syncGame() and read by /api/data. */
export type OracleCachePayload = {
  game: Game;
  status: 'bank-verified' | 'public-verified';
  latest: Draw;
  targetRound: number;
  targetDate: string | null;
  predictions: Record<ModelMode, Prediction[]>;
  accuracy: Record<'statistical', AccuracyStats> & Record<Exclude<ModelMode, 'statistical'>, BacktestResult>;
  benchmark: {
    statisticalLift: number;
    aiLift: number;
    hybridLift: number;
    /** Estimated lift from the "pick the best of 4 options after the fact" mechanism alone (see accuracy.ts evaluateSelectionBias), measured with zero-signal random variants. Applies to STATISTICAL/HYBRID, which both use selectProfile; AI doesn't select among profiles, so it has no bias to subtract. */
    selectionBiasLift: number;
    statisticalLiftAdjusted: number;
    hybridLiftAdjusted: number;
    note: string;
  };
  modelVersions: Record<ModelMode, string>;
  aiInfo: { model: string; trainingRows: number; features: string };
  sourceInfo: { primary: string; historySize: number; latestSource?: Draw['source'] };
  updatedAt: string;
  warnings: string[];
  benchmarkTests: number;
  notice: string;
};
