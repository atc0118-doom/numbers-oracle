import type { Draw, Game, Prediction } from './types';
import { generate } from './predict';
import { selectProfile } from './accuracy';

const softmax=(values:number[])=>{const max=Math.max(...values);const ex=values.map(v=>Math.exp(v-max));const sum=ex.reduce((a,b)=>a+b,0)||1;return ex.map(v=>v/sum)};
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*(b[i]??0),0);

function features(history:Draw[],game:Game):number[]{
  const len=game==='numbers3'?3:4;
  const sample=history.slice(0,Math.min(80,history.length));
  const out:number[]=[1];
  for(let pos=0;pos<len;pos++){
    const freq=Array(10).fill(0),last=Array(10).fill(sample.length);
    sample.forEach((d,i)=>{const n=Number(d.number[pos]);freq[n]++;if(last[n]===sample.length)last[n]=i});
    for(let n=0;n<10;n++)out.push(freq[n]/Math.max(1,sample.length));
    for(let n=0;n<10;n++)out.push(Math.min(last[n],30)/30);
    const prev=history[0]?.number[pos];
    for(let n=0;n<10;n++)out.push(Number(prev)===n?1:0);
  }
  const previous=history[0]?.number.split('').map(Number)??Array(len).fill(0);
  const sum=previous.reduce((a,b)=>a+b,0);
  out.push(sum/(9*len),previous.filter(n=>n%2===1).length/len,new Set(previous).size/len);
  return out;
}

function buildRows(draws:Draw[],game:Game,maxRows=300){
  const chronological=[...draws].sort((a,b)=>a.round-b.round);
  const rows:{x:number[];y:number[]}[]=[];
  for(let i=24;i<chronological.length;i++){
    const prior=chronological.slice(0,i).reverse();
    rows.push({x:features(prior,game),y:chronological[i].number.split('').map(Number)});
  }
  return rows.slice(-maxRows);
}

function train(draws:Draw[],game:Game){
  const len=game==='numbers3'?3:4,rows=buildRows(draws,game);
  const dim=rows[0]?.x.length??(1+len*30+3);
  const weights=Array.from({length:len},()=>Array.from({length:10},()=>Array(dim).fill(0)));
  const learning=.16,lambda=.0015,epochs=45;
  for(let epoch=0;epoch<epochs;epoch++){
    const rate=learning*(1-epoch/(epochs*1.35));
    for(const row of rows){
      for(let pos=0;pos<len;pos++){
        const probs=softmax(weights[pos].map(w=>dot(w,row.x)));
        for(let cls=0;cls<10;cls++){
          const error=(cls===row.y[pos]?1:0)-probs[cls];
          for(let j=0;j<dim;j++)weights[pos][cls][j]+=rate*(error*row.x[j]-lambda*weights[pos][cls][j]);
        }
      }
    }
  }
  return {weights,rows:rows.length};
}

export function generateAI(game:Game,draws:Draw[],count=10):{predictions:Prediction[];trainingRows:number;model:string}{
  const len=game==='numbers3'?3:4;
  const {weights,rows}=train(draws,game);
  const x=features(draws,game);
  const probabilities=weights.map(classes=>softmax(classes.map(w=>dot(w,x))));
  let beam:{number:string;logp:number;parts:number[]}[]=[{number:'',logp:0,parts:[]}];
  for(let pos=0;pos<len;pos++){
    const next=[] as typeof beam;
    for(const item of beam)for(let n=0;n<10;n++)next.push({number:item.number+n,logp:item.logp+Math.log(Math.max(probabilities[pos][n],1e-9)),parts:[...item.parts,probabilities[pos][n]]});
    beam=next.sort((a,b)=>b.logp-a.logp).slice(0,Math.max(count*8,60));
  }
  const max=beam[0]?.logp??0,min=beam[Math.min(beam.length-1,count*5)]?.logp??max-1;
  const predictions=beam.slice(0,count).map((item,index)=>{
    const score=Math.round(55+40*((item.logp-min)/Math.max(.0001,max-min)));
    const confidence=(item.parts.reduce((a,b)=>a+b,0)/len*100).toFixed(1);
    return {number:item.number,score:Math.max(35,Math.min(95,score)),relativeScore:100-index,reasons:[`多クラスロジスティック回帰`,`${rows}学習行`,`平均桁確信度 ${confidence}%`]};
  });
  return {predictions,trainingRows:rows,model:'MULTINOMIAL LOGISTIC'};
}

export function evaluateAI(game:Game,draws:Draw[],picks=10,maxTests=12){
  const boxKey=(v:string)=>[...v].sort().join('');
  let tested=0,straight=0,box=0,matched=0,total=0;
  const limit=Math.min(maxTests,draws.length-50);
  for(let i=0;i<limit;i++){
    const target=draws[i],training=draws.slice(i+1);
    if(training.length<50)continue;
    const values=generateAI(game,training,picks).predictions.map(p=>p.number);
    tested++;if(values.includes(target.number))straight++;if(values.some(v=>boxKey(v)===boxKey(target.number)))box++;
    matched+=values.reduce((best,v)=>Math.max(best,[...v].filter((c,j)=>c===target.number[j]).length),0);total+=target.number.length;
  }
  const rate=(n:number)=>tested?Number((n/tested*100).toFixed(2)):0;
  return {testedDraws:tested,picksPerDraw:picks,straightHits:straight,boxHits:box,straightRate:rate(straight),boxRate:rate(box),digitMatchRate:total?Number((matched/total*100).toFixed(1)):0};
}

export function hybrid(stat:Prediction[],ai:Prediction[],count=10):Prediction[]{
  const map=new Map<string,{stat:number;ai:number;reasons:string[]}>();
  stat.forEach((p,i)=>map.set(p.number,{stat:100-i*2,ai:0,reasons:['統計モデル上位']}));
  ai.forEach((p,i)=>{const current=map.get(p.number)??{stat:0,ai:0,reasons:[]};current.ai=100-i*2;current.reasons.push('AIモデル上位');map.set(p.number,current)});
  return [...map.entries()].map(([number,v])=>{const combined=v.stat*.45+v.ai*.55;return {number,score:Math.round(35+combined*.6),relativeScore:Math.round(combined),reasons:[...v.reasons,'統計45% + AI55%']}}).sort((a,b)=>b.relativeScore-a.relativeScore).slice(0,count);
}

/** Hybrid backtest uses the same statistical profile selection + AI model as live prediction. */
export function evaluateHybrid(game:Game,draws:Draw[],picks=10,maxTests=12){
  const boxKey=(v:string)=>[...v].sort().join('');
  let tested=0,straight=0,box=0,matched=0,total=0;
  const limit=Math.min(maxTests,draws.length-60);
  for(let i=0;i<limit;i++){
    const target=draws[i],training=draws.slice(i+1);
    if(training.length<60)continue;
    const profile=selectProfile(game,training);
    const stat=generate(game,training,20,profile);
    const ai=generateAI(game,training,20).predictions;
    const values=hybrid(stat,ai,picks).map(p=>p.number);
    tested++;if(values.includes(target.number))straight++;if(values.some(v=>boxKey(v)===boxKey(target.number)))box++;
    matched+=values.reduce((best,v)=>Math.max(best,[...v].filter((c,j)=>c===target.number[j]).length),0);total+=target.number.length;
  }
  const rate=(n:number)=>tested?Number((n/tested*100).toFixed(2)):0;
  return {testedDraws:tested,picksPerDraw:picks,straightHits:straight,boxHits:box,straightRate:rate(straight),boxRate:rate(box),digitMatchRate:total?Number((matched/total*100).toFixed(1)):0};
}
