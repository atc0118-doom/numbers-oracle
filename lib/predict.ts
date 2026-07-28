import type { Draw, Game, Prediction, WeightProfile } from './types';

function hash(s:string){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

export const PROFILES:WeightProfile[] = [
  {name:'BALANCED',frequency:.52,overdue:.18,pair:.12,sum:.08,parity:.06,unique:.04},
  {name:'FREQUENCY',frequency:.72,overdue:.08,pair:.10,sum:.04,parity:.03,unique:.03},
  {name:'OVERDUE',frequency:.32,overdue:.42,pair:.10,sum:.06,parity:.05,unique:.05},
  {name:'PAIR',frequency:.38,overdue:.12,pair:.30,sum:.08,parity:.06,unique:.06},
];

export function generate(game: Game, draws: Draw[], count=20, profile:WeightProfile=PROFILES[0]): Prediction[] {
  const len = game === 'numbers3' ? 3 : 4;
  const sample = draws.slice(0, Math.min(draws.length, 180));
  const freq = Array.from({length:len},()=>Array(10).fill(0));
  const lastSeen = Array.from({length:len},()=>Array(10).fill(sample.length+5));
  const pairs = Array.from({length:Math.max(0,len-1)},()=>Array.from({length:10},()=>Array(10).fill(0)));
  sample.forEach((d,idx)=>{
    const chars=d.number.split('');
    chars.forEach((c,pos)=>{const n=Number(c);freq[pos][n]++;if(lastSeen[pos][n]===sample.length+5)lastSeen[pos][n]=idx;});
    for(let p=0;p<len-1;p++) pairs[p][Number(chars[p])][Number(chars[p+1])]++;
  });
  const signature=sample.slice(0,12).map(d=>`${d.round}:${d.number}`).join('|');
  const random = rng(hash(`${game}-${profile.name}-${signature}`));
  const candidates = new Map<string,Prediction>();
  const maxFreq=Math.max(1,...freq.flat());
  const iterations=count>=20?700:350;

  for(let k=0;k<iterations;k++){
    let number='';
    for(let pos=0;pos<len;pos++){
      const prev=pos?Number(number[pos-1]):-1;
      const weights=Array.from({length:10},(_,n)=>{
        const f=freq[pos][n]/maxFreq;
        const overdue=Math.min(lastSeen[pos][n],20)/20;
        const pair=pos?pairs[pos-1][prev][n]/Math.max(1,...pairs[pos-1][prev]):0;
        return .05 + f*profile.frequency + overdue*profile.overdue + pair*profile.pair;
      });
      let x=random()*weights.reduce((a,b)=>a+b,0),pick=0;
      for(let n=0;n<10;n++){x-=weights[n];if(x<=0){pick=n;break}}
      number+=pick;
    }

    const chars=[...number].map(Number);
    const unique=new Set(number).size;
    const sum=chars.reduce((a,b)=>a+b,0);
    const odd=chars.filter(n=>n%2===1).length;
    const midpoint=len===3?[9,20]:[12,25];
    let raw=0;
    chars.forEach((n,pos)=>{
      raw += (freq[pos][n]/maxFreq)*profile.frequency*55;
      raw += (Math.min(lastSeen[pos][n],20)/20)*profile.overdue*35;
      if(pos>0){const denom=Math.max(1,...pairs[pos-1][chars[pos-1]]);raw+=(pairs[pos-1][chars[pos-1]][n]/denom)*profile.pair*45;}
    });
    const reasons:string[]=[];
    if(unique===len){raw+=profile.unique*25;reasons.push('全桁異数字');}else reasons.push('重複数字を含む');
    if(sum>=midpoint[0]&&sum<=midpoint[1]){raw+=profile.sum*30;reasons.push('合計値が中心帯');}
    if(odd>0&&odd<len){raw+=profile.parity*30;reasons.push('奇数・偶数混合');}
    reasons.push(`${profile.name}重みで自動評価`);
    const score=Math.max(35,Math.min(96,Math.round(38+raw/(len*.72))));
    const relativeScore=score;
    const prev=candidates.get(number);
    if(!prev||prev.score<score)candidates.set(number,{number,score,relativeScore,reasons});
  }
  return [...candidates.values()].sort((a,b)=>b.score-a.score||a.number.localeCompare(b.number)).slice(0,count);
}
