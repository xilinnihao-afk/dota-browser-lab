import type {MapData,Placement} from '../map-data';
import {type ModelId} from './definitions';
import {isBattleStructure} from './structures';
import type {Point} from './navigation';

export interface CampDefinition extends Point {
  id:string;name:string;sourceRect:string;model:ModelId;count:number;
  hp:number;damage:number;gold:number;xp:number;scale:number;respawn:number;
}
// Centres from the source JASS neutral spawn rectangles. Species/stats are trial rules.
export const CAMPS:readonly CampDefinition[]=[
  {id:'west',name:'西侧熊怪营地',sourceRect:'cr',x:-3216,y:-256,model:'furbolg',count:3,hp:390,damage:24,gold:65,xp:65,scale:1,respawn:45},
  {id:'south',name:'南侧狗头人营地',sourceRect:'mr',x:-416,y:-3584,model:'kobold',count:3,hp:260,damage:16,gold:45,xp:45,scale:1.2,respawn:40},
  {id:'northwest',name:'北岸萨特营地',sourceRect:'jr',x:-1648,y:2352,model:'satyr',count:3,hp:420,damage:28,gold:75,xp:75,scale:1.1,respawn:50},
  {id:'northeast',name:'东北熊怪营地',sourceRect:'lr',x:1232,y:3040,model:'furbolg',count:3,hp:520,damage:32,gold:90,xp:90,scale:1.2,respawn:50},
  {id:'boss',name:'河东岩石巨人',sourceRect:'Qr',x:2448,y:-528,model:'golem',count:1,hp:2200,damage:65,gold:350,xp:350,scale:2,respawn:90},
];
export interface ShopLocation extends Point {id:string;name:string}
const SHOP_IDS=new Set(['u010','uC74','n01K','nC38','n00V','n00W','n002','n009','n0HE','e025','u00Q']);
export function mapShops(map:MapData):ShopLocation[]{return map.placements.filter(p=>p.kind==='unit'&&SHOP_IDS.has(p.id)).map((p,i)=>({id:'shop-'+i,name:'装备商店',x:p.position[0],y:p.position[1]}));}
export function isBattlePlacement(p:Placement){return isBattleStructure(p)||(p.kind==='unit'&&p.id==='n00L'&&Math.abs(p.position[0]-2448)<1&&Math.abs(p.position[1]+528)<1);}
