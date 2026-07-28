import { NextResponse } from 'next/server';
import { fetchOfficialHistory, nextDrawDate } from '../../../lib/official';
import { generate } from '../../../lib/predict';
import { evaluateAccuracy, selectProfile } from '../../../lib/accuracy';
import { evaluateAI, evaluateHybrid, generateAI, hybrid } from '../../../lib/ai';
import { getForecasts, persistenceEnabled, summarizeLive } from '../../../lib/storage';
import type { Game } from '../../../lib/types';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;
export async function GET(req:Request){
 const game=(new URL(req.url).searchParams.get('game')==='numbers3'?'numbers3':'numbers4') as Game;
 try{
  const draws=await fetchOfficialHistory(game,500); if(draws.length<60)throw new Error(`公式履歴が不足しています（${draws.length}回）`);
  const profile=selectProfile(game,draws); const statistical=generate(game,draws,10,profile); const aiResult=generateAI(game,draws,10);
  const hybridPredictions=hybrid(generate(game,draws,20,profile),generateAI(game,draws,20).predictions,10);
  const rows=await getForecasts(game,90);
  return NextResponse.json({game,status:'official',latest:draws[0],targetRound:draws[0].round+1,targetDate:nextDrawDate(draws[0].date),predictions:{statistical,ai:aiResult.predictions,hybrid:hybridPredictions},
   accuracy:{statistical:evaluateAccuracy(game,draws,10,profile),ai:evaluateAI(game,draws,10,120),hybrid:evaluateHybrid(game,draws,10,120)},
   live:{enabled:persistenceEnabled(),summary:summarizeLive(rows),history:rows},
   aiInfo:{model:aiResult.model,trainingRows:aiResult.trainingRows,features:'桁別頻度・未出間隔・直前数字・合計・奇偶・重複度'},updatedAt:new Date().toISOString(),
   notice:'AI SCOREとRELATIVE SCOREは候補間の順位評価です。バックテスト成績と公開後の実運用成績は別集計で、当せんを保証しません。'});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'不明な取得エラー',status:'error'},{status:503});}
}
