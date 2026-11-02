import { createMap } from './map';
import { Navigation } from './navigation';
import type { GameState, MapDefinition, Point, Team, Unit, UnitKind, GameEvent, UnitStatus } from './types';

export const FIXED_STEP=1/30;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDifference=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
function makeUnit(id:string,name:string,kind:UnitKind,team:Team,x:number,z:number):Unit {
  const hero=kind==='hero',tower=kind==='tower';
  const hp=hero?760:tower?(team==='enemy'?420:1600):128;
  return {id,name,kind,team,x,z,home:{x,z},facing:team==='allied'?Math.PI:0,hp,maxHp:hp,
    radius:tower?2.05:hero?.7:.65,speed:tower?0:hero?7:3.5,
    damage:hero?48:tower?30:12,attackRange:tower?12:hero?1.75:1.45,
    attackPeriod:hero?.82:tower?1.4:1.35,windup:tower?.4:.28,
    attackTimer:0,windupLeft:0,actionTime:0,status:'idle',targetId:null,path:[],hitFlash:0,deathTime:0,repathTimer:0};
}
export class Simulation {
  readonly navigation:Navigation;
  state!:GameState;
  private eventSequence=0;
  constructor(readonly map:MapDefinition=createMap()) {this.navigation=new Navigation(map);this.reset();}
  get hero(){return this.state.units.find(u=>u.id===this.state.heroId)!;}
  getUnit(id:string|null){return this.state.units.find(u=>u.id===id);}
  reset() {
    this.eventSequence=0;
    const units=[makeUnit('hero','渡口守卫','hero','allied',-1,15),makeUnit('ally-tower','守望之塔','tower','allied',-4,21),
      makeUnit('guard-1','河岸守军','creep','enemy',-2,-11),makeUnit('guard-2','河岸守军','creep','enemy',3,-14),
      makeUnit('guard-3','高地守军','creep','enemy',-1,-18),makeUnit('enemy-tower','赤焰哨塔','tower','enemy',3,-23)];
    this.state={time:0,units,heroId:'hero',selectedId:'hero',hoveredId:null,phase:'playing',paused:false,kills:0,gold:0,attackMode:false,
      objective:'穿越浅滩，击败守军，摧毁赤焰哨塔',command:'右键移动 / 攻击 · 己方塔附近恢复生命',destination:null,events:[]};
  }
  private status(unit:Unit,value:UnitStatus){if(unit.status!==value){unit.status=value;unit.actionTime=0;}}
  private event(type:GameEvent['type'],p:Point,other:Partial<GameEvent>={}) {this.state.events.push({id:++this.eventSequence,type,x:p.x,z:p.z,time:this.state.time,...other});}
  select(id:string){if(this.getUnit(id))this.state.selectedId=id;}
  stop(){if(this.state.phase!=='playing'||this.state.paused)return;this.cancel(this.hero);this.state.command='停止';this.state.destination=null;this.state.attackMode=false;}
  private cancel(unit:Unit){unit.targetId=null;unit.path=[];unit.windupLeft=0;this.status(unit,'idle');}
  move(destination:Point) {
    if(this.state.phase!=='playing'||this.state.paused)return;
    const hero=this.hero;this.cancel(hero);
    hero.path=this.navigation.findPath(hero,destination);
    this.state.destination=hero.path.length?{...hero.path[hero.path.length-1]}:null;
    this.state.command=hero.path.length?'前往指定位置':'此处无法到达';
    this.state.attackMode=false;
    if(this.state.destination)this.event('command',this.state.destination,{team:'allied'});
  }
  attack(id:string) {
    if(this.state.phase!=='playing'||this.state.paused)return;
    const target=this.getUnit(id);if(!target||target.team===this.hero.team||target.hp<=0)return;
    this.cancel(this.hero);this.hero.targetId=id;this.hero.repathTimer=0;
    this.state.selectedId=id;this.state.destination=null;this.state.attackMode=false;this.state.command=`攻击 ${target.name}`;
    this.event('command',target,{team:'enemy',targetId:id});
  }
  togglePause(){if(this.state.phase==='playing'){this.state.paused=!this.state.paused;this.state.attackMode=false;}}
  private turn(unit:Unit,to:Point,dt:number):number {
    const wanted=Math.atan2(to.x-unit.x,to.z-unit.z),difference=angleDifference(wanted,unit.facing);
    unit.facing+=Math.max(-8*dt,Math.min(8*dt,difference));return Math.abs(difference);
  }
  private walk(unit:Unit,dt:number) {
    if(!unit.path.length){if(unit.status==='moving')this.status(unit,'idle');return;}
    const goal=unit.path[0],d=distance(unit,goal);
    if(d<.17){unit.path.shift();return;}
    const deltaAngle=this.turn(unit,goal,dt);
    // Turning has observable cost; numerical speed is deliberately a prototype value.
    const step=Math.min(d,unit.speed*dt*(deltaAngle>1.2?.3:1));
    const nx=unit.x+(goal.x-unit.x)/d*step,nz=unit.z+(goal.z-unit.z)/d*step;
    if(this.navigation.isFree(nx,nz,unit.radius)){unit.x=nx;unit.z=nz;}
    else if(Math.abs(nx-unit.x)>.00001&&this.navigation.isFree(nx,unit.z,unit.radius))unit.x=nx;
    else if(Math.abs(nz-unit.z)>.00001&&this.navigation.isFree(unit.x,nz,unit.radius))unit.z=nz;
    else {unit.path=[];unit.repathTimer=0;this.status(unit,'idle');return;}
    this.status(unit,'moving');
  }
  private findTarget(unit:Unit):Unit|undefined {
    const radius=unit.kind==='tower'?unit.attackRange:10.5;
    return this.state.units.filter(v=>v.team!==unit.team&&v.hp>0&&distance(unit,v)<=radius+v.radius).sort((a,b)=>distance(unit,a)-distance(unit,b))[0];
  }
  private chase(unit:Unit,target:Unit,dt:number) {
    const range=unit.attackRange+target.radius;
    if(distance(unit,target)<=range){unit.path=[];this.turn(unit,target,dt);if(unit.attackTimer<=0 && Math.abs(angleDifference(Math.atan2(target.x-unit.x,target.z-unit.z),unit.facing))<.35){unit.windupLeft=unit.windup;this.status(unit,'windup');}else if(unit.status!=='attacking')this.status(unit,'idle');return;}
    if(unit.kind==='tower'){unit.targetId=null;return;}
    if(unit.repathTimer<=0 || !unit.path.length){
      let desired:Point;
      if(target.kind==='tower') {const d=Math.max(.01,distance(unit,target));desired={x:target.x+(unit.x-target.x)/d*(target.radius+unit.radius+.22),z:target.z+(unit.z-target.z)/d*(target.radius+unit.radius+.22)};}
      else desired={x:target.x,z:target.z};
      unit.path=this.navigation.findPath(unit,desired);unit.repathTimer=.45;
    }
    this.walk(unit,dt);
  }
  private damage(source:Unit,target:Unit) {
    if(target.hp<=0)return;
    target.hp=Math.max(0,target.hp-source.damage);target.hitFlash=.18;
    this.event('hit',target,{sourceId:source.id,targetId:target.id,amount:source.damage,team:source.team});
    if(target.hp===0){
      this.cancel(target);this.status(target,'dead');target.deathTime=this.state.time;
      this.event('kill',target,{sourceId:source.id,targetId:target.id,team:source.team});
      if(target.team==='enemy'){this.state.kills++;this.state.gold+=target.kind==='tower'?200:45;}
      if(target.id==='hero'){this.state.phase='lost';this.state.objective='守卫倒下了，重整旗鼓再试一次';this.event('lose',target);}
      if(target.id==='enemy-tower'){this.state.phase='won';this.state.objective='渡口已夺回';this.event('win',target);}
      if(this.state.phase!=='playing'){
        this.state.attackMode=false;this.state.destination=null;
        for(const living of this.state.units)if(living.hp>0)this.cancel(living);
      }
    }
  }
  step(dt=FIXED_STEP) {
    if(this.state.paused||this.state.phase!=='playing')return;
    this.state.time+=dt;
    for(const unit of this.state.units){
      unit.hitFlash=Math.max(0,unit.hitFlash-dt);unit.actionTime+=dt;
      if(unit.hp<=0)continue;
      unit.attackTimer=Math.max(0,unit.attackTimer-dt);unit.repathTimer-=dt;
      let target=this.getUnit(unit.targetId);
      if(target&&target.hp<=0){unit.targetId=null;unit.windupLeft=0;target=undefined;this.status(unit,'idle');}
      if(unit.kind!=='hero'&&!target){target=this.findTarget(unit);if(target)unit.targetId=target.id;}
      if(unit.kind==='creep'&&distance(unit,unit.home)>17){this.cancel(unit);unit.path=this.navigation.findPath(unit,unit.home);target=undefined;}
      if(unit.status==='windup'&&target){
        this.turn(unit,target,dt);unit.windupLeft-=dt;
        if(unit.windupLeft<=0){
          unit.attackTimer=unit.attackPeriod;this.status(unit,'attacking');
          this.event('attack',unit,{sourceId:unit.id,targetId:target.id,team:unit.team});
          if(distance(unit,target)<=unit.attackRange+target.radius+.7)this.damage(unit,target);
        }
      } else {
        if(unit.status==='attacking'&&unit.actionTime>.22)this.status(unit,'idle');
        if(target&&unit.status!=='attacking')this.chase(unit,target,dt);
        else if(!target)this.walk(unit,dt);
      }
      if(this.state.phase!=='playing')break;
    }
    this.separateUnits();
    if(this.hero.hp>0 && this.state.phase==='playing') {
      const tower=this.getUnit('ally-tower')!;
      const healing=distance(this.hero,tower)<7.5&&tower.hp>0;
      this.hero.hp=Math.min(this.hero.maxHp,this.hero.hp+dt*(healing?28:1.1));
    }
    if(this.state.destination&&!this.hero.path.length)this.state.destination=null;
    // Events remain long enough for rendering consumers, bounded regardless of match length.
    this.state.events=this.state.events.filter(e=>this.state.time-e.time<2.5).slice(-96);
  }
  private separateUnits(){
    const mobile=this.state.units.filter(u=>u.hp>0&&u.kind!=='tower');
    for(let i=0;i<mobile.length;i++)for(let j=i+1;j<mobile.length;j++){
      const a=mobile[i],b=mobile[j],d=distance(a,b),minimum=a.radius+b.radius+.06;
      if(d>=minimum)continue;
      const dx=d>.001?(a.x-b.x)/d:1,dz=d>.001?(a.z-b.z)/d:0,push=(minimum-d)*.5;
      if(this.navigation.isFree(a.x+dx*push,a.z+dz*push,a.radius)){a.x+=dx*push;a.z+=dz*push;}
      if(this.navigation.isFree(b.x-dx*push,b.z-dz*push,b.radius)){b.x-=dx*push;b.z-=dz*push;}
    }
  }
}
