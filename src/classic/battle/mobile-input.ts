import type {Point} from './navigation';

/** Screen coordinates: right is +x, down is +y. Dead zone prevents resting-thumb drift. */
export function stickVector(dx:number,dy:number,radius=48,deadZone=.16):Point|null {
  const length=Math.hypot(dx,dy);
  if(!Number.isFinite(length)||length<=radius*deadZone)return null;
  return {x:dx/length,y:dy/length};
}
export function screenToWorld(vector:Point,right:Point):Point {
  const length=Math.hypot(right.x,right.y)||1,rx=right.x/length,ry=right.y/length;
  return {x:rx*vector.x+ry*vector.y,y:ry*vector.x-rx*vector.y};
}
export interface TouchTarget extends Point {id:string;team:number;hp:number;radius:number;kind:string;returning?:boolean;invulnerableUntil?:number}
export function touchTarget<T extends TouchTarget>(hero:TouchTarget,units:T[],options:{range:number;now:number;selected?:string|null;direction?:Point|null;skill?:boolean;visible?:(unit:T)=>boolean}):T|undefined {
  let best:T|undefined,score=Infinity;
  for(const u of units){
    if(u.hp<=0||u.team===hero.team||u.returning||(u.invulnerableUntil??0)>options.now||options.visible&&!options.visible(u))continue;
    if(options.skill&&(u.kind==='tower'||u.kind==='base'))continue;
    const dx=u.x-hero.x,dy=u.y-hero.y,d=Math.hypot(dx,dy);
    if(d>options.range+u.radius)continue;
    let alignment=1;
    if(options.direction){const n=Math.hypot(options.direction.x,options.direction.y);alignment=d&&n?(dx*options.direction.x+dy*options.direction.y)/(d*n):1;if(alignment<.72)continue;}
    // A drag explicitly changes direction; a tap keeps a valid selected target.
    const value=options.direction?(1-alignment)*options.range*2+d*.35:u.id===options.selected?-1:d+(u.kind==='tower'||u.kind==='base'?200:0);
    if(value<score){score=value;best=u;}
  }
  return best;
}
export const DIRECTIONAL_SKILLS=new Set(['gust','multishot','hook','dragonSlave','arrow','fissure','shock']);
export function touchAimPoint(hero:Point,drag:Point,range:number,right:Point,directional=false):Point {
  const length=Math.hypot(drag.x,drag.y),direction=screenToWorld(stickVector(drag.x,drag.y,1,0)??{x:0,y:-1},right);
  const distance=Math.max(0,range-.5)*(directional?1:Math.min(1,length/72));
  return {x:hero.x+direction.x*distance,y:hero.y+direction.y*distance};
}
/** Each control owns one pointer; releasing the other thumb must not end it. */
export class TouchPointer {
  id:number|null=null;
  claim(id:number){if(this.id!==null)return false;this.id=id;return true;}
  owns(id:number){return this.id===id;}
  release(id:number){if(!this.owns(id))return false;this.id=null;return true;}
  clear(){this.id=null;}
}
