import { NextResponse } from 'next/server';
import { fetchOfficialHistory, nextDrawDate } from '../../../lib/official';
import { generate } from '../../../lib/predict';
import { selectProfile } from '../../../lib/accuracy';
import { generateAI, hybrid } from '../../../lib/ai';
import { persistenceEnabled, saveForecast, settleForecasts } from '../../../lib/storage';
import type { Game } from '../../../lib/types';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;

async function processGame(game:Game){
 const draws=await fetchOfficialHistory(game,500); if(draws.length<60)throw new Error(`${game}: official history is insufficient`);
 const settlement=await settleForecasts(draws);
 const profile=selectProfile(game,draws);
 const statistical=generate(game,draws,10,profile);
 const ai=generateAI(game,draws,10).predictions;
 const hybrids=hybrid(generate(game,draws,20,profile),generateAI(game,draws,20).predictions,10);
 const targetRound=draws[0].round+1; const targetDate=nextDrawDate(draws[0].date);
 await Promise.all([
   saveForecast(game,targetRound,targetDate,'statistical',statistical),
   saveForecast(game,targetRound,targetDate,'ai',ai),
   saveForecast(game,targetRound,targetDate,'hybrid',hybrids),
 ]);
 return {latest:draws[0],targetRound,targetDate,settled:settlement.settled,saved:persistenceEnabled()};
}
export async function GET(req:Request){
 const auth=req.headers.get('authorization'); if(process.env.CRON_SECRET&&auth!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'unauthorized'},{status:401});
 try{const [numbers3,numbers4]=await Promise.all([processGame('numbers3'),processGame('numbers4')]);return NextResponse.json({ok:true,persistence:persistenceEnabled(),numbers3,numbers4,checkedAt:new Date().toISOString()});}
 catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'cron failed'},{status:500});}
}
