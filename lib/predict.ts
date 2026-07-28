import type { Draw, Game, Prediction } from './types';

function hash(s:string){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

export function generate(game: Game, draws: Draw[], count=10): Prediction[] {
  const len = game === 'numbers3' ? 3 : 4;
  const freq = Array.from({length:len},()=>Array(10).fill(0));
  const lastSeen = Array.from({length:len},()=>Array(10).fill(draws.length+5));
  draws.forEach((d,idx)=>d.number.split('').forEach((c,pos)=>{const n=Number(c);freq[pos][n]++;if(lastSeen[pos][n]===draws.length+5)lastSeen[pos][n]=idx;}));
  const r = rng(hash(`${game}-${draws[0]?.round}-${draws[0]?.number}-${new Date().toISOString().slice(0,10)}`));
  const candidates = new Map<string,Prediction>();
  for(let k=0;k<4000;k++){
    let number=''; let raw=0; const reasons:string[]=[];
    for(let pos=0;pos<len;pos++){
      const weights = Array.from({length:10},(_,n)=>1 + freq[pos][n]*0.45 + Math.min(lastSeen[pos][n],12)*0.13);
      let x=r()*weights.reduce((a,b)=>a+b,0), pick=0;
      for(let n=0;n<10;n++){x-=weights[n];if(x<=0){pick=n;break}}
      number+=pick; raw += freq[pos][pick]*2 + Math.min(lastSeen[pos][pick],10);
    }
    const unique=new Set(number).size;
    raw += unique*2;
    if(unique===len) reasons.push('全桁異数字'); else reasons.push('ダブル数字を含む');
    const sum=[...number].reduce((a,c)=>a+Number(c),0);
    if(sum>=10 && sum<=26){raw+=5;reasons.push('合計値が中間帯');}
    const odd=[...number].filter(c=>Number(c)%2).length;
    if(odd>0&&odd<len){raw+=4;reasons.push('奇数・偶数混合');}
    reasons.push('桁別頻度と空白期間を合成');
    const score=Math.max(45,Math.min(89,Math.round(48+raw/(len*2.8))));
    const prev=candidates.get(number); if(!prev||prev.score<score)candidates.set(number,{number,score,reasons});
  }
  return [...candidates.values()].sort((a,b)=>b.score-a.score||a.number.localeCompare(b.number)).slice(0,count);
}
