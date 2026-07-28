import { NextResponse } from 'next/server';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(){
  return NextResponse.json({ok:true,message:'V6.4では処理を分割しています。/api/cron/numbers3 と /api/cron/numbers4 を使用してください。'});
}
