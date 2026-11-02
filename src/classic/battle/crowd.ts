import type {CombatUnit,NavigationPort} from './simulation';
import {distance,type Point} from './navigation';
import {isStructure} from './structures';

export const isCreep=(u:CombatUnit)=>u.kind==='melee'||u.kind==='ranged';
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const relative=(a:Point,b:Point)=>({x:a.x-b.x,y:a.y-b.y});

/** Local avoidance keeps a chosen passing side until the obstruction is behind.
 * No formation slots and no backward separation forces: a narrow queue waits. */
export function creepStep(u:CombatUnit,goal:Point,step:number,units:readonly CombatUnit[],nav:NavigationPort):Point|null {
  const length=distance(u,goal);if(length<.001)return null;
  const dir={x:(goal.x-u.x)/length,y:(goal.y-u.y)/length},normal={x:-dir.y,y:dir.x};
  const nearby=units.filter(v=>v!==u&&v.hp>0&&!isStructure(v)&&distance(u,v)<220);
  const clearance=(v:CombatUnit)=>u.radius+v.radius+6;
  let blocker=u.avoidance?nearby.find(v=>v.id===u.avoidance!.id):undefined;
  if(blocker&&dot(relative(blocker,u),dir)<-clearance(blocker)*.5){u.avoidance=undefined;blocker=undefined;}
  if(!blocker){
    u.avoidance=undefined;let nearest=Infinity;
    for(const v of nearby){const delta=relative(v,u),forward=dot(delta,dir),side=dot(delta,normal);
      if(forward>=0&&forward<Math.min(length,110)&&Math.abs(side)<clearance(v)+8&&forward<nearest){blocker=v;nearest=forward;}
    }
    if(blocker){
      const delta=relative(blocker,u),lateral=dot(delta,normal);
      // Pass away from an offset neighbour. A consistent right-hand choice
      // breaks head-on ties without both units repeatedly swapping sides.
      let side:1|-1=lateral>4?-1:lateral< -4?1:-1;
      const flank=(s:number)=>({x:blocker!.x+normal.x*s*(clearance(blocker!)+18),y:blocker!.y+normal.y*s*(clearance(blocker!)+18)});
      if(!nav.lineFree(u,flank(side))&&nav.lineFree(u,flank(-side)))side=side===1?-1:1;
      u.avoidance={id:blocker.id,side};
    }
  }
  let desired=dir;
  if(blocker&&u.avoidance){
    const flank={x:blocker.x+normal.x*u.avoidance.side*(clearance(blocker)+18)+dir.x*clearance(blocker)*.6,y:blocker.y+normal.y*u.avoidance.side*(clearance(blocker)+18)+dir.y*clearance(blocker)*.6};
    const d=distance(u,flank);if(d>1)desired={x:(flank.x-u.x)/d,y:(flank.y-u.y)/d};
  }
  const base=Math.atan2(dir.y,dir.x),wanted=Math.max(-Math.PI/2,Math.min(Math.PI/2,Math.atan2(dir.x*desired.y-dir.y*desired.x,dot(dir,desired))));
  const angles=[wanted,0,...[.35,.7,1.05,Math.PI/2].flatMap(a=>[a,-a])].sort((a,b)=>Math.abs(a-wanted)-Math.abs(b-wanted));
  for(const angle of angles){
    // Keep the selected side while approaching a blocker; don't zigzag back
    // to the other side each frame when another creep briefly closes a gap.
    if(blocker&&u.avoidance&&angle*u.avoidance.side<-.05)continue;
    const next={x:u.x+Math.cos(base+angle)*step,y:u.y+Math.sin(base+angle)*step};
    if(!nav.lineFree(u,next))continue;
    const movement=relative(next,u),len2=dot(movement,movement);
    const clear=nearby.every(v=>{
      const delta=relative(v,u),t=Math.max(0,Math.min(1,dot(delta,movement)/len2));
      const closest={x:u.x+movement.x*t,y:u.y+movement.y*t};
      const before=distance(u,v),limit=clearance(v);
      // Allow overlapping spawn/keyboard positions to separate, never deepen.
      return before<limit?distance(next,v)>before+.00001:distance(closest,v)>=limit;
    });
    if(clear)return next;
  }
  return null;
}
