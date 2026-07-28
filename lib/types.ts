export type Game = 'numbers3' | 'numbers4';
export type Draw = { game: Game; round: number; date: string; number: string; source: 'official' | 'seed' };
export type WeightProfile = {
  name: string;
  frequency: number;
  overdue: number;
  pair: number;
  sum: number;
  parity: number;
  unique: number;
};
export type Prediction = {
  number: string;
  score: number;
  estimatedRate: number;
  reasons: string[];
};
