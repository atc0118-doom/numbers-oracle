import type { Draw, Game, WeightProfile } from './types';
import { generate, PROFILES } from './predict';

export type AccuracyStats = {
  testedDraws:number;picksPerDraw:number;straightHits:number;boxHits:number;
  straightRate:number;boxRate:number;digitMatchRate:number;dataQuality:'official'|'reference';
  selectedProfile:string;historySize:number;
};
const boxKey=(v:string)=>[...v].sort().join('');

function quickScore(game:Game,draws:Draw[],profile:WeightProfile){
  let score=0,tested=0;
  const limit=Math.min(36,draws.length-20);
  for(let i=0;i<limit;i+=3){
    const target=draws[i], training=draws.slice(i+1);
    const values=generate(game,training,10,profile).map(p=>p.number);
    if(values.includes(target.number)) score+=6;
    else if(values.some(v=>boxKey(v)===boxKey(target.number))) score+=2;
    score+=values.reduce((best,v)=>Math.max(best,[...v].filter((c,j)=>c===target.number[j]).length),0)*.15;
    tested++;
  }
  return tested?score/tested:0;
}
export function selectProfile(game:Game,draws:Draw[]):WeightProfile{
  return [...PROFILES].sort((a,b)=>quickScore(game,draws,b)-quickScore(game,draws,a))[0];
}
export function evaluateAccuracy(game:Game,draws:Draw[],picksPerDraw=20,profile=selectProfile(game,draws),testLimit=48):AccuracyStats{
  let tested=0,straight=0,box=0,matched=0,total=0;
  const maxTests=Math.min(testLimit,draws.length-24);
  for(let i=0;i<maxTests;i++){
    const target=draws[i],training=draws.slice(i+1);
    if(training.length<24)continue;
    const values=generate(game,training,picksPerDraw,profile).map(p=>p.number);
    tested++;
    if(values.includes(target.number))straight++;
    if(values.some(v=>boxKey(v)===boxKey(target.number)))box++;
    matched+=values.reduce((best,v)=>Math.max(best,[...v].filter((c,j)=>c===target.number[j]).length),0);
    total+=target.number.length;
  }
  const rate=(n:number)=>tested?Number((n/tested*100).toFixed(2)):0;
  return {testedDraws:tested,picksPerDraw,straightHits:straight,boxHits:box,straightRate:rate(straight),boxRate:rate(box),digitMatchRate:total?Number((matched/total*100).toFixed(1)):0,dataQuality:draws.every(d=>d.source==='official')?'official':'reference',selectedProfile:profile.name,historySize:draws.length};
}
