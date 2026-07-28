'use client';
import {useEffect,useState} from 'react';
type Accuracy={testedDraws:number;picksPerDraw:number;straightHits:number;boxHits:number;straightRate:number;boxRate:number;digitMatchRate:number;dataQuality:'official'|'reference'};
type Data={game:string;status:string;latest:{round:number;date:string;number:string;source:string};predictions:{number:string;score:number;reasons:string[]}[];accuracy:Accuracy;updatedAt:string;notice:string};
export default function Home(){const[game,setGame]=useState('numbers4');const[data,setData]=useState<Data|null>(null);const[loading,setLoading]=useState(true);
 useEffect(()=>{setLoading(true);fetch(`/api/data?game=${game}`,{cache:'no-store'}).then(r=>r.json()).then(setData).finally(()=>setLoading(false))},[game]);
 return <main><header><div className="eyebrow">AUTOMATED STATISTICAL OBSERVATORY</div><h1>NUMBERS <span>ORACLE</span></h1><p>公式結果を照合し、次回候補と過去検証成績を自動更新</p></header>
 <nav><button className={game==='numbers3'?'on':''} onClick={()=>setGame('numbers3')}>NUMBERS 3</button><button className={game==='numbers4'?'on':''} onClick={()=>setGame('numbers4')}>NUMBERS 4</button></nav>
 {loading||!data?<section className="loading">ANALYZING...</section>:<>
 <section className="status"><div><small>DATA LINK</small><b className={data.status==='official'?'ok':'warn'}>{data.status==='official'?'OFFICIAL':'FALLBACK'}</b></div><div><small>LATEST DRAW</small><b>第{data.latest.round}回 / {data.latest.number}</b></div><div><small>DRAW DATE</small><b>{data.latest.date}</b></div></section>
 <section><h2>BACKTEST ACCURACY</h2><div className="accuracy">
  <div><small>STRAIGHT HIT RATE</small><strong>{data.accuracy.straightRate.toFixed(2)}%</strong><p>{data.accuracy.straightHits} / {data.accuracy.testedDraws}回</p></div>
  <div><small>BOX HIT RATE</small><strong>{data.accuracy.boxRate.toFixed(2)}%</strong><p>{data.accuracy.boxHits} / {data.accuracy.testedDraws}回</p></div>
  <div><small>BEST DIGIT MATCH</small><strong>{data.accuracy.digitMatchRate.toFixed(1)}%</strong><p>各回の上位{data.accuracy.picksPerDraw}口で検証</p></div>
  <div><small>DATA QUALITY</small><strong className={data.accuracy.dataQuality==='official'?'ok':'warn'}>{data.accuracy.dataQuality==='official'?'OFFICIAL':'REFERENCE'}</strong><p>{data.accuracy.testedDraws}回分のウォークフォワード検証</p></div>
 </div><p className="accuracy-note">対象回より前のデータだけで予想を再生成し、実際の当せん番号と照合しています。初期データを含む間は参考値です。</p></section>
 <section><h2>NEXT PREDICTIONS</h2><div className="grid">{data.predictions.map((p,i)=><article key={p.number}><div className="rank">RANK {String(i+1).padStart(2,'0')}</div><div className="number">{p.number}</div><div className="meter"><i style={{width:`${p.score}%`}}/></div><strong>ORACLE INDEX {p.score}</strong><p>{p.reasons.join(' / ')}</p></article>)}</div></section>
 <footer><p>{data.notice}</p><p>最終解析：{new Date(data.updatedAt).toLocaleString('ja-JP')}</p></footer></>}
 </main>}
