import type { Draw, Game } from './types';

// 公式全履歴を永続保存するDBがない状態でも、分析画面とウォークフォワード検証を
// 安定稼働させるための決定論的な参照履歴。公式データではないためUIではREFERENCEと明示する。
function rng(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

export function seedDraws(game: Game): Draw[] {
  const length = game === 'numbers3' ? 360 : 420;
  const digits = game === 'numbers3' ? 3 : 4;
  const random = rng(game === 'numbers3' ? 314159 : 271828);
  const draws: Draw[] = [];
  for(let i=0;i<length;i++){
    let number='';
    for(let p=0;p<digits;p++) number += Math.floor(random()*10);
    draws.push({game,round:7000-i,date:'参照履歴',number,source:'seed'});
  }
  return draws;
}
