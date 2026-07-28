import type { Game } from './types';
import { fetchOfficialHistory, nextDrawDate } from './official';
import { generate } from './predict';
import { evaluateAccuracy, selectProfile } from './accuracy';
import { evaluateAI, evaluateHybrid, generateAI, hybrid } from './ai';
import { persistenceEnabled, saveForecast, saveOracleCache, settleForecasts } from './storage';

export async function syncGame(game:Game){
  const warnings:string[]=[];
  if(!persistenceEnabled()) throw new Error('Supabase環境変数が未設定です');
  console.info('[oracle][sync]',game,'stage=history:start');
  const draws=await fetchOfficialHistory(game,70);
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
  console.info('[oracle][sync]',game,'stage=predict:ok','target',targetRound,targetDate);

  for(const [model,preds] of [['statistical',statistical],['ai',aiResult.predictions],['hybrid',hybridPredictions]] as const){
    try{await saveForecast(game,targetRound,targetDate,model,preds);console.info('[oracle][sync]',game,'stage=forecast:ok',model)}
    catch(e){const m=e instanceof Error?e.message:String(e);warnings.push(`forecast:${model}:${m}`);console.error('[oracle][sync]',game,'stage=forecast:error',model,e)}
  }

  console.info('[oracle][sync]',game,'stage=backtest:start');
  const payload={
    game,status:draws[0].source==='public-fallback'?'public-verified':'bank-verified',latest:draws[0],targetRound,targetDate,
    predictions:{statistical,ai:aiResult.predictions,hybrid:hybridPredictions},
    accuracy:{statistical:evaluateAccuracy(game,draws,10,profile,36),ai:evaluateAI(game,draws,10,12),hybrid:evaluateHybrid(game,draws,10,12)},
    aiInfo:{model:aiResult.model,trainingRows:aiResult.trainingRows,features:'桁別頻度・未出間隔・直前数字・合計・奇偶・重複度'},
    sourceInfo:{primary:draws[0].source==='public-fallback'?'楽天銀行履歴 + 公開速報補完':'楽天銀行 当せん番号案内',historySize:draws.length,latestSource:draws[0].source},
    updatedAt:new Date().toISOString(),warnings,
    notice:'AI SCOREとRELATIVE SCOREは候補間の順位評価です。バックテスト成績と公開後の実運用成績は別集計で、当せんを保証しません。',
  };
  console.info('[oracle][sync]',game,'stage=cache:start');
  await saveOracleCache(game,payload);
  console.info('[oracle][sync]',game,'stage=cache:ok');
  return {latest:draws[0],targetRound,targetDate,settled,cached:true,historySize:draws.length,warnings};
}
