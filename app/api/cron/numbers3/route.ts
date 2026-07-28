import { NextResponse } from 'next/server';
import { syncGame } from '../../../../lib/sync';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;
export async function GET(req:Request){
  const auth=req.headers.get('authorization');
  if(process.env.CRON_SECRET&&auth!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'unauthorized'},{status:401});
  try{return NextResponse.json({ok:true,game:'numbers3',result:await syncGame('numbers3'),checkedAt:new Date().toISOString()});}
  catch(e){return NextResponse.json({ok:false,game:'numbers3',error:e instanceof Error?e.message:'cron failed'},{status:500});}
}
