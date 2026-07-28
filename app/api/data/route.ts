import { NextResponse } from 'next/server';
import { getForecasts, getOracleCache, persistenceEnabled, summarizeLive } from '../../../lib/storage';
import type { Game } from '../../../lib/types';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=15;

export async function GET(req:Request){
  const game=(new URL(req.url).searchParams.get('game')==='numbers3'?'numbers3':'numbers4') as Game;
  try{
    if(!persistenceEnabled()) throw new Error('Supabaseが未接続です');
    const [cache,rows]=await Promise.all([getOracleCache(game),getForecasts(game,90)]);
    if(!cache?.payload){
      return NextResponse.json({error:'初回同期がまだです。Vercel Cronを実行してください。',status:'needs-sync'},{status:503});
    }
    return NextResponse.json({...cache.payload,live:{enabled:true,summary:summarizeLive(rows),history:rows},cacheUpdatedAt:cache.updated_at});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'データ読込エラー',status:'error'},{status:503});}
}
