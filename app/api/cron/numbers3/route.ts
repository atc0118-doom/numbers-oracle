import { NextResponse } from 'next/server';
import { syncGame } from '../../../../lib/sync';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;
export async function GET(req:Request){
  const auth=req.headers.get('authorization');
  if(process.env.CRON_SECRET&&auth!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'unauthorized'},{status:401});
  try{
    const result=await syncGame('numbers3');
    return NextResponse.json({ok:true,game:'numbers3',result,checkedAt:new Date().toISOString()});
  }catch(e){
    const message=e instanceof Error?e.message:'cron failed';
    console.error('[oracle][cron][numbers3]',e);
    if(message.startsWith('SOURCE_STALE:')) return NextResponse.json({ok:false,stale:true,game:'numbers3',error:message,checkedAt:new Date().toISOString()},{status:200});
    return NextResponse.json({ok:false,game:'numbers3',error:message,checkedAt:new Date().toISOString()},{status:500});
  }
}
