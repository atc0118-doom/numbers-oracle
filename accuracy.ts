import type { Draw, Game } from './types';
import { generate } from './predict';

export type AccuracyStats = {
  testedDraws: number;
  picksPerDraw: number;
  straightHits: number;
  boxHits: number;
  straightRate: number;
  boxRate: number;
  digitMatchRate: number;
  dataQuality: 'official' | 'reference';
};

const boxKey = (value:string) => [...value].sort().join('');

export function evaluateAccuracy(game:Game, draws:Draw[], picksPerDraw=10):AccuracyStats {
  let testedDraws=0, straightHits=0, boxHits=0, matchedDigits=0, totalDigits=0;
  const minTraining = Math.min(8, Math.max(5, draws.length - 1));

  // draws は新しい順。対象回より古い履歴だけで候補を生成し、未来情報の混入を防ぐ。
  for(let targetIndex=0; targetIndex < draws.length - minTraining; targetIndex++){
    const target=draws[targetIndex];
    const training=draws.slice(targetIndex + 1);
    if(training.length < minTraining) continue;
    const predictions=generate(game,training,picksPerDraw);
    const values=predictions.map(p=>p.number);
    testedDraws++;
    if(values.includes(target.number)) straightHits++;
    if(values.some(v=>boxKey(v)===boxKey(target.number))) boxHits++;

    const bestDigitMatches=values.reduce((best,value)=>{
      const matches=[...value].filter((c,i)=>c===target.number[i]).length;
      return Math.max(best,matches);
    },0);
    matchedDigits += bestDigitMatches;
    totalDigits += target.number.length;
  }

  const rate=(hits:number)=>testedDraws ? Number((hits/testedDraws*100).toFixed(2)) : 0;
  return {
    testedDraws,
    picksPerDraw,
    straightHits,
    boxHits,
    straightRate:rate(straightHits),
    boxRate:rate(boxHits),
    digitMatchRate:totalDigits ? Number((matchedDigits/totalDigits*100).toFixed(1)) : 0,
    dataQuality:draws.every(d=>d.source==='official')?'official':'reference'
  };
}
