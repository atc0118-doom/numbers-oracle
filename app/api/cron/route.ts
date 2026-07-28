import { NextResponse } from 'next/server';
import { fetchLatest } from '../../../lib/official';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const auth=req.headers.get('authorization');
 if(process.env.CRON_SECRET && auth!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ok:false},{status:401});
 const [n3,n4]=await Promise.allSettled([fetchLatest('numbers3'),fetchLatest('numbers4')]);
 return NextResponse.json({ok:true,checkedAt:new Date().toISOString(),numbers3:n3.status==='fulfilled'?n3.value:null,numbers4:n4.status==='fulfilled'?n4.value:null});
}
