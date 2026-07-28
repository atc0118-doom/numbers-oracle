import { NextResponse } from 'next/server';
import { getForecasts, getOracleCache, persistenceEnabled, summarizeLive } from '../../../lib/storage';
import { MODEL_VERSIONS } from '../../../lib/models';
import type { Game } from '../../../lib/types';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=15;

export async function GET(req:Request){
  const game=(new URL(req.url).searchParams.get('game')==='numbers3'?'numbers3':'numbers4') as Game;
  try{
    if(!persistenceEnabled()) throw new Error('Supabaseが未接続です');
    const [cache,rows]=await Promise.all([getOracleCache(game),getForecasts(game,240)]);
    if(!cache?.payload){return NextResponse.json({error:'初回同期がまだです。Vercel Cronを実行してください。',status:'needs-sync'},{status:503});}
    if(!cache.payload?.accuracy?.random || !cache.payload?.predictions?.random){return NextResponse.json({error:'V7初回同期が必要です。Numbers3 / Numbers4 のCronをRunしてください。',status:'needs-v7-sync'},{status:503});}
    const versions=cache.payload.modelVersions??MODEL_VERSIONS;
    return NextResponse.json({...cache.payload,live:{enabled:true,summary:summarizeLive(rows,versions),history:rows},cacheUpdatedAt:cache.updated_at});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'データ読込エラー',status:'error'},{status:503});}
}
