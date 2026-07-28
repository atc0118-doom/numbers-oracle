import { NextResponse } from 'next/server';
import { fetchLatest } from '../../../lib/official';
import { seedDraws } from '../../../lib/seed';
import { generate } from '../../../lib/predict';
import { evaluateAccuracy } from '../../../lib/accuracy';
import type { Game } from '../../../lib/types';
export const dynamic='force-dynamic';
export async function GET(req:Request){
  const game=(new URL(req.url).searchParams.get('game')==='numbers3'?'numbers3':'numbers4') as Game;
  const seed=seedDraws(game); let latest=null; let status='fallback';
  try{latest=await fetchLatest(game);status=latest?'official':'fallback';}catch{}
  const draws=latest?[latest,...seed.filter(x=>x.number!==latest!.number)]:seed;
  const predictions=generate(game,draws);
  const accuracy=evaluateAccuracy(game,draws,predictions.length);
  return NextResponse.json({game,status,latest:draws[0],predictions,accuracy,updatedAt:new Date().toISOString(),notice:'的中率は過去データによるバックテスト参考値です。将来の当せんを保証するものではありません。'});
}
