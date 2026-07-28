import type { Draw, Game, Prediction } from './types';
import type { ModelMode } from './models';
export type { ModelMode } from './models';

export type SavedForecast={
  id?:string;game:Game;target_round:number;target_date:string|null;model:ModelMode;model_version:string;
  picks:string[];scores:number[];purchase_type?:'straight';stake_yen?:number;return_yen?:number|null;roi_percent?:number|null;
  created_at?:string;settled_at?:string|null;winning_number?:string|null;straight_hit?:boolean|null;box_hit?:boolean|null;
  best_digit_match?:number|null;status?:'pending'|'settled'
};
export type OracleCacheRow={game:Game;payload:any;updated_at?:string};
function cfg(){const url=process.env.SUPABASE_URL?.replace(/\/$/,'')??'';const key=process.env.SUPABASE_SERVICE_ROLE_KEY??'';return{enabled:Boolean(url&&key),url,key}}
export function persistenceEnabled(){return cfg().enabled}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const c=cfg();if(!c.enabled)throw new Error('Supabase persistence is not configured');
  const h=new Headers(init.headers);h.set('apikey',c.key);h.set('Authorization',`Bearer ${c.key}`);h.set('Content-Type','application/json');if(!h.has('Prefer'))h.set('Prefer','return=representation');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(`${c.url}/rest/v1/${path}`,{...init,headers:h,cache:'no-store',signal:controller.signal});
    const text=await r.text();
    if(!r.ok){console.error('[oracle][supabase]',init.method??'GET',path,r.status,text.slice(0,1200));throw new Error(`SUPABASE_${r.status}:${text.slice(0,500)}`)}
    return (text?JSON.parse(text):null) as T;
  }catch(e){console.error('[oracle][supabase-request]',init.method??'GET',path,e);throw e}finally{clearTimeout(timer)}
}
export async function saveForecast(game:Game,targetRound:number,targetDate:string|null,model:ModelMode,modelVersion:string,predictions:Prediction[]){
  if(!persistenceEnabled())return null;
  const payload={game,target_round:targetRound,target_date:targetDate,model,model_version:modelVersion,picks:predictions.map(p=>p.number),scores:predictions.map(p=>Number.isFinite(p.score)?p.score:0),purchase_type:'straight',stake_yen:predictions.length*200,status:'pending'};
  const rows=await request<SavedForecast[]>('forecasts?on_conflict=game,target_round,model,model_version',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});return rows?.[0]??null
}
const boxKey=(v:string)=>[...v].sort().join('');
export function settleValues(picks:string[],winning:string){const straight=picks.includes(winning);const box=picks.some(v=>boxKey(v)===boxKey(winning));const best=picks.reduce((m,v)=>Math.max(m,[...v].filter((c,i)=>c===winning[i]).length),0);return{straight_hit:straight,box_hit:box,best_digit_match:best}}
export async function settleForecasts(draws:Draw[]){if(!persistenceEnabled())return{settled:0};const game=draws[0]?.game;if(!game)return{settled:0};const pending=await request<SavedForecast[]>(`forecasts?game=eq.${game}&status=eq.pending&select=*`);const byRound=new Map(draws.map(d=>[d.round,d]));let settled=0;for(const row of pending){const draw=byRound.get(row.target_round);if(!draw||!row.id)continue;const result=settleValues(row.picks,draw.number);const payout=result.straight_hit?(draw.payouts?.straight??null):0;const stake=row.stake_yen??row.picks.length*200;const roi=payout===null?null:Number((((payout-stake)/stake)*100).toFixed(2));await request(`forecasts?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',body:JSON.stringify({...result,winning_number:draw.number,return_yen:payout,roi_percent:roi,status:'settled',settled_at:new Date().toISOString()})});settled++}return{settled}}
export async function getForecasts(game:Game,limit=240){if(!persistenceEnabled())return[] as SavedForecast[];return request<SavedForecast[]>(`forecasts?game=eq.${game}&select=*&order=target_round.desc,model.asc&limit=${limit}`)}

function summarizeGroup(model:ModelMode,modelVersion:string,items:SavedForecast[]){
  const n=items.length,stake=items.reduce((s,r)=>s+(r.stake_yen??0),0),ret=items.reduce((s,r)=>s+(r.return_yen??0),0),known=items.some(r=>r.return_yen!==null&&r.return_yen!==undefined);
  return{model,modelVersion,draws:n,straightHits:items.filter(r=>r.straight_hit).length,boxHits:items.filter(r=>r.box_hit).length,straightRate:n?Number((items.filter(r=>r.straight_hit).length/n*100).toFixed(2)):0,boxRate:n?Number((items.filter(r=>r.box_hit).length/n*100).toFixed(2)):0,avgDigitMatch:n?Number((items.reduce((s,r)=>s+(r.best_digit_match??0),0)/n).toFixed(3)):0,stakeYen:stake,returnYen:known?ret:null,roiPercent:known&&stake?Number((((ret-stake)/stake)*100).toFixed(2)):null}
}

export function summarizeLive(rows:SavedForecast[],currentVersions:Record<ModelMode,string>){
  const settled=rows.filter(r=>r.status==='settled');
  const modes=(['hybrid','ai','statistical','random'] as ModelMode[]);
  const byModel=modes.map(model=>summarizeGroup(model,currentVersions[model],settled.filter(r=>r.model===model&&r.model_version===currentVersions[model])));
  const versionKeys=new Map<string,SavedForecast[]>();
  for(const r of settled){const key=`${r.model}::${r.model_version??'LEGACY'}`;const arr=versionKeys.get(key)??[];arr.push(r);versionKeys.set(key,arr)}
  const byVersion=[...versionKeys.entries()].map(([key,items])=>{const [model,version]=key.split('::');return summarizeGroup(model as ModelMode,version,items)}).sort((a,b)=>b.draws-a.draws);
  const randomVersion=currentVersions.random;
  const randomRows=settled.filter(r=>r.model==='random'&&r.model_version===randomVersion);
  const randomByRound=new Map(randomRows.map(r=>[r.target_round,r]));
  const benchmark=modes.filter(m=>m!=='random').map(model=>{
    const modelRows=settled.filter(r=>r.model===model&&r.model_version===currentVersions[model]&&randomByRound.has(r.target_round));
    const pairs=modelRows.map(m=>({m,r:randomByRound.get(m.target_round)!}));
    const n=pairs.length;
    const mAvg=n?pairs.reduce((s,p)=>s+(p.m.best_digit_match??0),0)/n:0;
    const rAvg=n?pairs.reduce((s,p)=>s+(p.r.best_digit_match??0),0)/n:0;
    return {model,modelVersion:currentVersions[model],pairedDraws:n,avgDigitMatch:Number(mAvg.toFixed(3)),randomAvgDigitMatch:Number(rAvg.toFixed(3)),digitLift:Number((mAvg-rAvg).toFixed(3)),straightDelta:pairs.filter(p=>p.m.straight_hit).length-pairs.filter(p=>p.r.straight_hit).length,boxDelta:pairs.filter(p=>p.m.box_hit).length-pairs.filter(p=>p.r.box_hit).length};
  });
  return{startedAt:rows.length?[...rows].sort((a,b)=>(a.created_at??'').localeCompare(b.created_at??''))[0].created_at:null,totalSettled:settled.length,byModel,byVersion,benchmark}
}
export async function saveOracleCache(game:Game,payload:any){if(!persistenceEnabled())throw new Error('Supabase cache is not configured');const rows=await request<OracleCacheRow[]>('oracle_cache?on_conflict=game',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({game,payload,updated_at:new Date().toISOString()})});return rows?.[0]??null}
export async function getOracleCache(game:Game){if(!persistenceEnabled())return null;const rows=await request<OracleCacheRow[]>(`oracle_cache?game=eq.${game}&select=game,payload,updated_at&limit=1`);return rows?.[0]??null}
