import type { Game, Prediction, Draw } from './types';

function hash(input:string){let h=2166136261;for(const c of input){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/**
 * Reproducible random benchmark. The seed uses only game + target round,
 * which are known before the draw. It never uses the winning number/history.
 */
export function generateRandom(game:Game,targetRound:number,count=10):Prediction[]{
  const digits=game==='numbers3'?3:4;
  const max=10**digits;
  const random=rng(hash(`NUMBERS_ORACLE_RANDOM_7:${game}:${targetRound}`));
  const chosen=new Set<number>();
  while(chosen.size<Math.min(count,max)) chosen.add(Math.floor(random()*max));
  return [...chosen].map((n,index)=>({
    number:String(n).padStart(digits,'0'),
    score:50,
    relativeScore:100-index,
    reasons:['RANDOM BASELINE','対象回のみを種にした再現可能な擬似乱数','当せん履歴は不使用'],
  }));
}

export function evaluateRandom(game:Game,draws:Draw[],picks=10,maxTests=12){
  const boxKey=(v:string)=>[...v].sort().join('');
  let tested=0,straight=0,box=0,matched=0,total=0;
  const limit=Math.min(maxTests,draws.length);
  for(let i=0;i<limit;i++){
    const target=draws[i];
    const values=generateRandom(game,target.round,picks).map(p=>p.number);
    tested++;
    if(values.includes(target.number))straight++;
    if(values.some(v=>boxKey(v)===boxKey(target.number)))box++;
    matched+=values.reduce((best,v)=>Math.max(best,[...v].filter((c,j)=>c===target.number[j]).length),0);
    total+=target.number.length;
  }
  const rate=(n:number)=>tested?Number((n/tested*100).toFixed(2)):0;
  return {testedDraws:tested,picksPerDraw:picks,straightHits:straight,boxHits:box,straightRate:rate(straight),boxRate:rate(box),digitMatchRate:total?Number((matched/total*100).toFixed(1)):0};
}
