import type { Game } from './types';
import { fetchOfficialHistory, nextDrawDate } from './official';
import { generate } from './predict';
import { evaluateAccuracy, selectProfile } from './accuracy';
import { evaluateAI, evaluateHybrid, generateAI, hybrid } from './ai';
import { evaluateRandom, generateRandom } from './random';
import { MODEL_VERSIONS, type ModelMode } from './models';
import { persistenceEnabled, saveForecast, saveOracleCache, settleForecasts } from './storage';

export async function syncGame(game:Game){
  const warnings:string[]=[];
  if(!persistenceEnabled()) throw new Error('Supabase環境変数が未設定です');
  console.info('[oracle][sync]',game,'stage=history:start');
  const draws=await fetchOfficialHistory(game,80);
  console.info('[oracle][sync]',game,'stage=history:ok','latest',draws[0]?.round,draws[0]?.number,draws[0]?.date,draws[0]?.source,'rows',draws.length);

  let settled=0;
  try{const r=await settleForecasts(draws);settled=r.settled;console.info('[oracle][sync]',game,'stage=settle:ok',settled)}
  catch(e){const m=e instanceof Error?e.message:String(e);warnings.push(`settle:${m}`);console.error('[oracle][sync]',game,'stage=settle:error',e)}

  console.info('[oracle][sync]',game,'stage=predict:start');
  const profile=selectProfile(game,draws);
  const statistical=generate(game,draws,10,profile);
  const aiResult=generateAI(game,draws,10);
  const hybridPredictions=hybrid(generate(game,draws,20,profile),generateAI(game,draws,20).predictions,10);
  const targetRound=draws[0].round+1;
  const targetDate=nextDrawDate(draws[0].date);
  const randomPredictions=generateRandom(game,targetRound,10);
  console.info('[oracle][sync]',game,'stage=predict:ok','target',targetRound,targetDate);

  const sets:Record<ModelMode,typeof statistical>={statistical,ai:aiResult.predictions,hybrid:hybridPredictions,random:randomPredictions};
  for(const model of ['statistical','ai','hybrid','random'] as ModelMode[]){
    try{await saveForecast(game,targetRound,targetDate,model,MODEL_VERSIONS[model],sets[model]);console.info('[oracle][sync]',game,'stage=forecast:ok',model,MODEL_VERSIONS[model])}
    catch(e){const m=e instanceof Error?e.message:String(e);warnings.push(`forecast:${model}:${m}`);console.error('[oracle][sync]',game,'stage=forecast:error',model,e)}
  }

  console.info('[oracle][sync]',game,'stage=backtest:start');
  const benchmarkTests=Math.max(0,Math.min(8,draws.length-60));
  const accuracy={
    statistical:evaluateAccuracy(game,draws,10,benchmarkTests),
    ai:evaluateAI(game,draws,10,benchmarkTests),
    hybrid:evaluateHybrid(game,draws,10,benchmarkTests),
    random:evaluateRandom(game,draws,10,benchmarkTests),
  };
  const randomDigit=accuracy.random.digitMatchRate||0;
  const benchmark={
    statisticalLift:Number((accuracy.statistical.digitMatchRate-randomDigit).toFixed(1)),
    aiLift:Number((accuracy.ai.digitMatchRate-randomDigit).toFixed(1)),
    hybridLift:Number((accuracy.hybrid.digitMatchRate-randomDigit).toFixed(1)),
    note:'同じ対象回・同じ10口条件でRANDOM BASELINEとの差を比較。短期差は偶然の可能性が高く、公開後実績を優先して評価します。'
  };
  const payload={
    game,status:draws[0].source==='public-fallback'?'public-verified':'bank-verified',latest:draws[0],targetRound,targetDate,
    predictions:{statistical,ai:aiResult.predictions,hybrid:hybridPredictions,random:randomPredictions},
    accuracy,benchmark,modelVersions:MODEL_VERSIONS,
    aiInfo:{model:aiResult.model,trainingRows:aiResult.trainingRows,features:'桁別頻度・未出間隔・直前数字・合計・奇偶・重複度'},
    sourceInfo:{primary:draws[0].source==='public-fallback'?'楽天銀行履歴 + 公開速報補完':'楽天銀行 当せん番号案内',historySize:draws.length,latestSource:draws[0].source},
    updatedAt:new Date().toISOString(),warnings,
    benchmarkTests,notice:'V7はAI・統計・HYBRIDをRANDOM BASELINEと同条件で検証します。スコアは当せん確率ではありません。短期バックテストより、事前保存された公開後実績を重視してください。',
  };
  console.info('[oracle][sync]',game,'stage=cache:start');
  await saveOracleCache(game,payload);
  console.info('[oracle][sync]',game,'stage=cache:ok');
  return {latest:draws[0],targetRound,targetDate,settled,cached:true,historySize:draws.length,warnings,modelVersions:MODEL_VERSIONS};
}
