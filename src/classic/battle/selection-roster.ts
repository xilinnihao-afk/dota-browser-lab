import {HEROES,assets,type HeroId} from './definitions';

export interface SelectionHero {id:string;name:string;model:string;playable:HeroId;x:number;y:number;scale:number}
const altarHeroes=[
  ['antimage','敌法师',2],['drow','卓尔游侠',2],['lich','巫妖',2],
  ['pudge','屠夫',1.65],['lina','秀逗魔导士',2.2],['mirana','月之女祭司',1.6],
  ['furion','先知',1.7],['earthshaker','撼地神牛',1.6],['shaman','暗影萨满',2.1],
] as const;
export const SELECTION_HEROES:SelectionHero[]=[
  ...altarHeroes.map(([id,name,scale],i)=>({id,name,scale,model:assets.models[id],playable:id,x:Math.cos(Math.PI*i/8)*1180,y:Math.sin(Math.PI*i/8)*880+130})),
  ...(['juggernaut','axe','maiden'] as const).map((id,i)=>({id,name:HEROES[id].name,model:assets.models[id],playable:id,x:(i-1)*630,y:i===1?-540:-490,scale:id==='maiden'?2.3:1.9})),
];
export function playableSelection(id:string):HeroId|undefined{return SELECTION_HEROES.find(h=>h.id===id)?.playable;}
