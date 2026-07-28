import type { Game } from './types';
import { fetchOfficialHistory, nextDrawDate } from './official';
import { generate } from './predict';
import { evaluateAccuracy, selectProfile } from './accuracy';
import { evaluateAI, evaluateHybrid, generateAI, hybrid } from './ai';
import { persistenceEnabled, saveForecast, saveOracleCache, settleForecasts } from './storage';

export async function syncGame(game:Game){
  if(!persistenceEnabled()) throw new Error('Supabase環境変数が未設定です');
  const draws=await fetchOfficialHistory(game,160);
  const settlement=await settleForecasts(draws);
  const profile=selectProfile(game,draws);
  const statistical=generate(game,draws,10,profile);
  const aiResult=generateAI(game,draws,10);
  const hybridPredictions=hybrid(generate(game,draws,20,profile),generateAI(game,draws,20).predictions,10);
  const targetRound=draws[0].round+1;
  const targetDate=nextDrawDate(draws[0].date);
  await Promise.all([
    saveForecast(game,targetRound,targetDate,'statistical',statistical),
    saveForecast(game,targetRound,targetDate,'ai',aiResult.predictions),
    saveForecast(game,targetRound,targetDate,'hybrid',hybridPredictions),
  ]);

  // 重いバックテストは同期時だけ実行。閲覧APIでは再計算しない。
  const payload={
    game,
    status:draws[0].source==='public-fallback'?'public-verified':'bank-verified',
    latest:draws[0],
    targetRound,
    targetDate,
    predictions:{statistical,ai:aiResult.predictions,hybrid:hybridPredictions},
    accuracy:{
      statistical:evaluateAccuracy(game,draws,10,profile,48),
      ai:evaluateAI(game,draws,10,18),
      hybrid:evaluateHybrid(game,draws,10,18),
    },
    aiInfo:{model:aiResult.model,trainingRows:aiResult.trainingRows,features:'桁別頻度・未出間隔・直前数字・合計・奇偶・重複度'},
    sourceInfo:{primary:draws[0].source==='public-fallback'?'楽天銀行履歴 + 公開速報補完':'楽天銀行 当せん番号案内',historySize:draws.length,latestSource:draws[0].source},
    updatedAt:new Date().toISOString(),
    notice:'AI SCOREとRELATIVE SCOREは候補間の順位評価です。バックテスト成績と公開後の実運用成績は別集計で、当せんを保証しません。',
  };
  await saveOracleCache(game,payload);
  return {latest:draws[0],targetRound,targetDate,settled:settlement.settled,cached:true,historySize:draws.length};
}
