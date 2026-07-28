'use client';
import {useEffect,useState} from 'react';
type Accuracy={testedDraws:number;picksPerDraw:number;straightHits:number;boxHits:number;straightRate:number;boxRate:number;digitMatchRate:number;dataQuality:'official'|'reference';selectedProfile:string;historySize:number};
type Prediction={number:string;score:number;estimatedRate:number;reasons:string[]};
type Data={game:string;status:string;latest:{round:number;date:string;number:string;source:string};predictions:Prediction[];accuracy:Accuracy;updatedAt:string;notice:string};
export default function Home(){
 const[game,setGame]=useState('numbers4');const[data,setData]=useState<Data|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');
 useEffect(()=>{setLoading(true);setError('');fetch(`/api/data?game=${game}`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('分析APIの取得に失敗しました');return r.json()}).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[game]);
 return <main><header><div className="eyebrow">ADAPTIVE STATISTICAL OBSERVATORY / V2</div><h1>NUMBERS <span>ORACLE</span></h1><p>公式最新結果を照合し、重みを自動選択して次回20候補を生成</p></header>
 <nav><button className={game==='numbers3'?'on':''} onClick={()=>setGame('numbers3')}>NUMBERS 3</button><button className={game==='numbers4'?'on':''} onClick={()=>setGame('numbers4')}>NUMBERS 4</button></nav>
 {loading?<section className="loading">ANALYZING...</section>:error?<section className="error">{error}</section>:data&&<>
 <section className="status"><div><small>DATA LINK</small><b className={data.status==='official'?'ok':'warn'}>{data.status==='official'?'OFFICIAL':'FALLBACK'}</b></div><div><small>LATEST DRAW</small><b>第{data.latest.round}回 / {data.latest.number}</b></div><div><small>DRAW DATE</small><b>{data.latest.date}</b></div><div><small>AUTO PROFILE</small><b className="accent">{data.accuracy.selectedProfile}</b></div></section>
 <section><h2>BACKTEST ACCURACY</h2><div className="accuracy">
  <div><small>STRAIGHT HIT RATE</small><strong>{data.accuracy.straightRate.toFixed(2)}%</strong><p>{data.accuracy.straightHits} / {data.accuracy.testedDraws}回</p></div>
  <div><small>BOX HIT RATE</small><strong>{data.accuracy.boxRate.toFixed(2)}%</strong><p>{data.accuracy.boxHits} / {data.accuracy.testedDraws}回</p></div>
  <div><small>BEST DIGIT MATCH</small><strong>{data.accuracy.digitMatchRate.toFixed(1)}%</strong><p>各回の上位{data.accuracy.picksPerDraw}口</p></div>
  <div><small>DATA QUALITY</small><strong className={data.accuracy.dataQuality==='official'?'ok':'warn'}>{data.accuracy.dataQuality==='official'?'OFFICIAL':'REFERENCE'}</strong><p>履歴{data.accuracy.historySize}回 / 検証{data.accuracy.testedDraws}回</p></div>
 </div><p className="accuracy-note">対象回より前の履歴だけで予想を再生成するウォークフォワード検証です。REFERENCEは公式全履歴ではないため参考値です。</p></section>
 <section><div className="section-head"><h2>NEXT 20 PREDICTIONS</h2><span>候補別推定値はモデル内の相対参考値</span></div><div className="grid">{data.predictions.map((p,i)=><article key={p.number}><div className="rank">RANK {String(i+1).padStart(2,'0')}</div><div className="number">{p.number}</div><div className="meter"><i style={{width:`${p.score}%`}}/></div><div className="metrics"><strong>ORACLE INDEX {p.score}</strong><strong>MODEL EST. {p.estimatedRate}%</strong></div><p>{p.reasons.join(' / ')}</p></article>)}</div></section>
 <footer><p>{data.notice}</p><p>最終解析：{new Date(data.updatedAt).toLocaleString('ja-JP')}</p></footer></>}
 </main>
}
