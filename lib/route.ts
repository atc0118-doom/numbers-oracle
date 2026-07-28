import { NextResponse } from 'next/server';
import { fetchLatest } from '../../../lib/official';
import { seedDraws } from '../../../lib/seed';
import { generate } from '../../../lib/predict';
import { evaluateAccuracy, selectProfile } from '../../../lib/accuracy';
import type { Game } from '../../../lib/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
  const game=(new URL(req.url).searchParams.get('game')==='numbers3'?'numbers3':'numbers4') as Game;
  const seed=seedDraws(game);let latest=null;let status='fallback';
  try{latest=await fetchLatest(game);status=latest?'official':'fallback';}catch{}
  const draws=latest?[latest,...seed.filter(x=>x.number!==latest!.number)]:seed;
  const profile=selectProfile(game,draws);
  const predictions=generate(game,draws,20,profile);
  const accuracy=evaluateAccuracy(game,draws,20,profile);
  return NextResponse.json({game,status,latest:draws[0],predictions,accuracy,updatedAt:new Date().toISOString(),notice:'推定値・的中率は参照履歴によるバックテスト結果です。抽せんは独立した確率事象で、将来の当せんを保証しません。'});
}
