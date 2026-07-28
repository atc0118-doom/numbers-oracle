export type Game = 'numbers3' | 'numbers4';
export type Draw = {
  game: Game; round: number; date: string; number: string; source: 'official'|'bank-fallback'|'cache';
  payouts?: { straight?: number|null; box?: number|null };
};
export type WeightProfile = {name:string;frequency:number;overdue:number;pair:number;sum:number;parity:number;unique:number};
export type Prediction = {number:string;score:number;relativeScore:number;reasons:string[]};
