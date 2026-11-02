import * as THREE from 'three';
import type {BattleSimulation,CombatEvent,CombatUnit} from './simulation';
import type {AbilityVisual} from './extra-abilities';
import type {Point} from './navigation';

// Each skill has a distinct silhouette or motion; combat owns all persistent states.
export const PRESENTED_SKILLS=[
  'spin','ward','slash','call','helix','cull','nova','freeze','storm',
  'manaBreak','blink','manaVoid','frostArrows','gust','multishot','frostBlast','frostShield','chainFrost',
  'hook','rot','dismember','dragonSlave','lightStrike','laguna','arrow','leap','starfall',
  'sprout','teleport','wrath','fissure','enchant','echo','shock','hex','serpentWard',
] as const;
const supported=new Set<string>(PRESENTED_SKILLS);
const stateDriven=new Set(['spin','ward','storm','manaBreak','frostArrows','frostShield','rot','dismember','multishot','hook','arrow','teleport','serpentWard','enchant']);
const C={earth:0xc99248,gold:0xffd45e,white:0xffefb8,ice:0x65ceff,iceWhite:0xd5f8ff,fire:0xff712b,red:0xef543e,green:0x8cdb62,poison:0x85b437,violet:0xbb75ff,lightning:0xb5dbff};
type Primitive='glow'|'line'|'rock'|'shard'|'star'|'orb'|'dark'|'flame';
interface Batch {mesh:THREE.InstancedMesh;alpha:THREE.InstancedBufferAttribute;capacity:number}
interface Flash {event:CombatEvent;start:number;duration:number}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const noise=(i:number)=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};

export function controlLabel(u:CombatUnit,now:number,silenced=false):string {
  if(u.hp<=0)return '';
  if(u.stunUntil>now)return u.rootUntil>now&&silenced?'妖术':'眩晕';
  if(u.rootUntil>now)return '定身';
  if(u.tauntUntil>now)return '嘲讽';
  if(silenced)return '沉默';
  if(u.slowUntil>now)return '减速';
  return '';
}

/** Bounded instance batches; no emitter, geometry or material allocation per cast. */
export class SkillEffects {
  readonly root=new THREE.Group();
  private readonly batches=new Map<Primitive,Batch>();
  private flashes:Flash[]=[];
  private matrix=new THREE.Matrix4();
  private quaternion=new THREE.Quaternion();
  private position=new THREE.Vector3();
  private scale=new THREE.Vector3();
  private color=new THREE.Color();
  private axis=new THREE.Vector3(1,0,0);
  private up=new THREE.Vector3(0,0,1);
  private direction=new THREE.Vector3();
  private billboard=new THREE.Quaternion();
  private flameTexture:THREE.DataTexture;
  private time=0;
  private live=0;
  private controls=0;
  private dropped=0;
  private spawned=0;
  private bySkill:Record<string,number>={};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,y:number)=>number,glow?:THREE.Texture){
    this.root.name='hero-skill-effects';parent.add(this.root);
    // A soft, tapered fire silhouette, shared by all flames. Ice retains solid
    // crystal geometry, so the two spells read differently without bloom.
    const fire=new Uint8Array(64*128*4);
    for(let y=0;y<128;y++)for(let x=0;x<64;x++){
      const v=y/127,u=x/63*2-1,center=Math.sin(v*8)*.12,width=.56*Math.pow(1-v,.72)+.02;
      const density=clamp((width-Math.abs(u-center))/.18),core=clamp((width*.62-Math.abs(u-center))/.18)*(1-v);
      const a=density*clamp(v/.08)*clamp((1-v)/.12),i=(y*64+x)*4;
      fire[i]=255;fire[i+1]=Math.round(70+core*170);fire[i+2]=Math.round(12+core*100);fire[i+3]=Math.round(a*a*255);
    }
    this.flameTexture=new THREE.DataTexture(fire,64,128);this.flameTexture.colorSpace=THREE.SRGBColorSpace;this.flameTexture.minFilter=this.flameTexture.magFilter=THREE.LinearFilter;this.flameTexture.needsUpdate=true;
    const star=new THREE.Shape();
    for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?.43:1;i?star.lineTo(Math.cos(a)*r,Math.sin(a)*r):star.moveTo(Math.cos(a)*r,Math.sin(a)*r);}star.closePath();
    const rock=new THREE.IcosahedronGeometry(1,0),p=rock.getAttribute('position'),colors=[];
    for(let i=0;i<p.count;i++){const light=.58+Math.max(0,p.getZ(i))*.4;colors.push(light,light,light);}rock.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const shard=new THREE.ConeGeometry(1,2,5);shard.rotateX(Math.PI/2);
    const specs:[Primitive,THREE.BufferGeometry,number,boolean][]=[
      ['glow',new THREE.PlaneGeometry(1,1),320,true],['line',new THREE.BoxGeometry(1,1,1),1536,true],
      ['rock',rock,320,false],['shard',shard,256,true],['star',new THREE.ShapeGeometry(star),256,true],
      ['orb',new THREE.SphereGeometry(1,10,7),128,true],['dark',new THREE.BoxGeometry(1,1,1),256,false],
      ['flame',new THREE.PlaneGeometry(1,1),96,true],
    ];
    for(const [name,geometry,capacity,additive]of specs){
      const alpha=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);alpha.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('effectAlpha',alpha);
      const material=new THREE.MeshBasicMaterial({map:name==='flame'?this.flameTexture:name==='glow'?glow??null:null,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false,vertexColors:name==='rock',blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
      material.onBeforeCompile=shader=>{
        shader.vertexShader='attribute float effectAlpha; varying float vEffectAlpha;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvEffectAlpha=effectAlpha;');
        shader.fragmentShader='varying float vEffectAlpha;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= vEffectAlpha;');
      };
      material.customProgramCacheKey=()=>`skill-alpha-${name}`;
      const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='skill-'+name;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.renderOrder=name==='dark'?18:name==='rock'?19:34;
      // Allocate instance colors once, including empty initial frames.
      mesh.setColorAt(0,new THREE.Color(0xffffff));mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.batches.set(name,{mesh,alpha,capacity});this.root.add(mesh);
    }
  }

  event(event:CombatEvent){
    if(event.kind!=='ability'||!event.effect||!supported.has(event.effect))return;
    this.spawned++;this.bySkill[event.effect]=(this.bySkill[event.effect]??0)+1;
    if(event.stage==='cast'&&(stateDriven.has(event.effect)||['blink','leap','lightStrike','chainFrost','wrath','starfall'].includes(event.effect)))return;
    const duration=event.effect==='fissure'?2.15:event.effect==='echo'?(event.stage==='cast'?1.15:.65):event.effect==='dragonSlave'?.72:event.effect==='multishot'?.52:event.effect==='laguna'||event.effect==='shock'?.45:.8;
    if(this.flashes.length>=64)this.flashes.shift();
    this.flashes.push({event:{...event,end:event.end?{...event.end}:undefined},start:event.time??this.time,duration});
  }

  private add(kind:Primitive,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number,alpha=1,angle=0,rotation?:THREE.Quaternion){
    if(alpha<=.002||!Number.isFinite(x+y+z+sx+sy+sz))return;
    const b=this.batches.get(kind)!;if(b.mesh.count>=b.capacity){this.dropped++;return;}
    const i=b.mesh.count++;this.position.set(x,y,z);this.scale.set(Math.max(.001,sx),Math.max(.001,sy),Math.max(.001,sz));
    if(rotation)this.quaternion.copy(rotation);else this.quaternion.setFromAxisAngle(this.up,angle);
    this.matrix.compose(this.position,this.quaternion,this.scale);b.mesh.setMatrixAt(i,this.matrix);b.mesh.setColorAt(i,this.color.setHex(color));b.alpha.setX(i,clamp(alpha));
  }
  private line(a:THREE.Vector3,b:THREE.Vector3,width:number,color:number,alpha=1,solid=false){
    this.direction.subVectors(b,a);const length=this.direction.length();if(length<.01)return;
    const q=new THREE.Quaternion().setFromUnitVectors(this.axis,this.direction.divideScalar(length));
    this.add(solid?'dark':'line',(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,length,width,width*.6,color,alpha,0,q);
  }
  private at(p:Point,z=8){return new THREE.Vector3(p.x,p.y,this.ground(p.x,p.y)+z);}
  private ring(p:Point,radius:number,width:number,color:number,alpha:number,z=8,arc=Math.PI*2,angle=0,terrain=true){
    const segments=Math.max(8,Math.ceil(36*arc/(Math.PI*2))),base=this.ground(p.x,p.y);
    for(let i=0;i<segments;i++){
      const a=angle+i/segments*arc,b=angle+(i+1)/segments*arc;
      const x1=p.x+Math.cos(a)*radius,y1=p.y+Math.sin(a)*radius,x2=p.x+Math.cos(b)*radius,y2=p.y+Math.sin(b)*radius;
      this.line(new THREE.Vector3(x1,y1,(terrain?this.ground(x1,y1):base)+z),new THREE.Vector3(x2,y2,(terrain?this.ground(x2,y2):base)+z),width,color,alpha);
    }
  }
  private burst(p:Point,radius:number,color:number,age:number,seed=0,ice=false){
    const fade=Math.pow(1-clamp(age),1.5);
    this.ring(p,Math.max(8,radius*(.18+age*.82)),7,color,fade*.85);
    for(let i=0;i<12;i++){
      const a=i*Math.PI*2/12+noise(i+seed)*.35,r=radius*(.1+age*.72),x=p.x+Math.cos(a)*r,y=p.y+Math.sin(a)*r;
      const h=Math.sin(clamp(age)*Math.PI)*(35+noise(i+9)*90);
      this.add(ice?'shard':'glow',x,y,this.ground(x,y)+h+20,ice?12:50,ice?12:50,ice?35:1,color,fade,a);
    }
  }
  private bolt(from:Point,to:Point,color:number,age:number,seed:number,z=110){
    const a=this.at(from,z),b=this.at(to,z),dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy));let previous=a;
    for(let i=1;i<=9;i++){
      const f=i/9,jitter=i===9?0:(noise(i*7+seed+Math.floor(age*8))-.5)*75;
      const next=new THREE.Vector3(a.x+dx*f-dy/length*jitter,a.y+dy*f+dx/length*jitter,a.z+(b.z-a.z)*f+jitter*.4);
      this.line(previous,next,9,color,1-age);this.line(previous,next,3,0xffffff,1-age);previous=next;
    }
    this.add('glow',b.x,b.y,b.z,110,110,1,color,(1-age)*.7);
  }
  private arrow(p:Point,d:Point,color:number,alpha=1,z=110){
    const tip=this.at(p,z),back=new THREE.Vector3(tip.x-d.x*90,tip.y-d.y*90,tip.z);
    this.line(back,tip,5,color,alpha);
    for(const side of [-1,1])this.line(tip,new THREE.Vector3(tip.x-d.x*27-d.y*side*18,tip.y-d.y*27+d.x*side*18,tip.z),6,C.iceWhite,alpha);
    this.add('glow',tip.x,tip.y,tip.z,70,70,1,color,alpha*.6);
  }

  private transient(f:Flash){
    const e=f.event,age=clamp((this.time-f.start)/f.duration),fade=1-age,id=e.effect!,p={x:e.x,y:e.y},end=e.end??p;
    const angle=e.direction??Math.atan2(end.y-p.y,end.x-p.x),d={x:Math.cos(angle),y:Math.sin(angle)},radius=e.radius??200;
    if(id==='fissure'){
      const length=e.range??900,front=clamp(age/.12);
      for(let i=0;i<19;i++){
        const t=(i+.3)/19;if(t>front)continue;
        const local=clamp((age-t*.12)/.1),life=clamp((1-age)/.22),offset=(noise(i+e.id)-.5)*54;
        const x=p.x+d.x*length*t-d.y*offset,y=p.y+d.y*length*t+d.x*offset,z=this.ground(x,y);
        const size=22+noise(i+4)*24,h=(38+noise(i+e.id+2)*60)*local*life;
        this.add('rock',x,y,z+h*.35,size,28+noise(i)*20,h,0x81725b,Math.min(1,fade*5),noise(i)*6);
        const side=i%2?1:-1,chipX=x-d.y*side*43,chipY=y+d.x*side*43;
        this.add('rock',chipX,chipY,this.ground(chipX,chipY)+h*.2,12,17,h*.4,0x695d4c,life,noise(i+13)*6);
        const before={x:p.x+d.x*length*(t-.04),y:p.y+d.y*length*(t-.04)};
        this.line(this.at(before,4),new THREE.Vector3(x,y,z+5),26,0x24190f,life,true);
        this.line(this.at(before,9),new THREE.Vector3(x,y,z+10),3,0xe7a948,life*.55);
        this.line(new THREE.Vector3(x,y,z+5),this.at({x:chipX,y:chipY},5),9,0x2b2119,life,true);
        this.add('glow',x,y,z+30+Math.sin(local*Math.PI)*60,95,95,1,C.earth,Math.max(0,1-local)*.5);
      }
      return;
    }
    if(id==='echo'||id==='enchant'||id==='call'||id==='helix'){
      const waves=id==='echo'&&e.stage==='cast'?3:1,color=id==='helix'?C.red:id==='call'?C.fire:C.gold;
      for(let i=0;i<waves;i++){
        const t=(age-i*.17)/(1-i*.17);if(t<0)continue;
        this.ring(p,Math.max(15,radius*(.1+.9*t)),id==='echo'?16:10,color,(1-t)*.9);
        if(id==='echo')this.ring(p,Math.max(10,radius*(.1+.9*t)-22),4,C.white,(1-t)*.65);
      }
      if(id==='echo'||id==='enchant')for(let i=0;i<16;i++){
        const a=i*Math.PI/8,r=radius*(.2+.7*age),x=p.x+Math.cos(a)*r,y=p.y+Math.sin(a)*r,h=Math.sin(age*Math.PI)*55;
        this.add('rock',x,y,this.ground(x,y)+h,13,18,14,C.earth,fade,a);
      }
      if(id==='helix')this.ring(p,150,20,C.white,fade,100,Math.PI*1.7,age*Math.PI*3,false);
      return;
    }
    if(id==='dragonSlave'||id==='gust'||id==='multishot'){
      const range=id==='multishot'?radius:e.range??800,travel=range*age;
      if(id==='multishot')for(const offset of [-.23,-.115,0,.115,.23]){const a=angle+offset;this.arrow({x:p.x+Math.cos(a)*travel,y:p.y+Math.sin(a)*travel},{x:Math.cos(a),y:Math.sin(a)},C.ice,fade);}
      else if(id==='gust')for(let i=0;i<3;i++){const t=Math.max(0,travel-i*100);this.ring({x:p.x+d.x*t,y:p.y+d.y*t},95,6,C.iceWhite,fade*(1-i*.2),55,Math.PI,angle-Math.PI/2,false);}
      else for(let i=0;i<15;i++){
        const along=travel-i*19;if(along<0)continue;
        const spread=(noise(i+e.id)-.5)*105,x=p.x+d.x*along-d.y*spread,y=p.y+d.y*along+d.x*spread,z=this.ground(x,y);
        const height=110+noise(i+7)*120;
        this.add('flame',x,y,z+height*.5,70+noise(i)*40,height,1,0xffe1a0,fade*.82,0,this.billboard);
        this.add('glow',x,y,z+70,160,160,1,C.fire,fade*.32);
      }
      return;
    }
    if(['laguna','wrath','chainFrost','shock','serpentWard'].includes(id)){
      const color=id==='wrath'||id==='serpentWard'?C.green:id==='shock'?C.gold:C.lightning;
      if(id==='shock'&&e.stage==='cast')for(const a of [angle-.2,angle,angle+.2])this.bolt(p,{x:p.x+Math.cos(a)*(e.range??800),y:p.y+Math.sin(a)*(e.range??800)},color,age,e.id);
      else this.bolt(p,end,color,age,e.id,id==='serpentWard'?150:120);
      if(id==='chainFrost')this.add('orb',end.x,end.y,this.ground(end.x,end.y)+110,35*fade,35*fade,35*fade,C.ice,.65);
      return;
    }
    if(id==='blink'||id==='leap'||id==='teleport'){
      const color=id==='leap'?C.iceWhite:id==='teleport'?C.green:C.violet;
      this.burst(p,130,color,age,e.id);this.burst(end,170,color,age,e.id+1);
      for(let i=0;i<8;i++){
        const t=clamp(age-i*.035),x=p.x+(end.x-p.x)*t,y=p.y+(end.y-p.y)*t;
        this.add('glow',x,y,this.ground(x,y)+60+(id==='leap'?Math.sin(t*Math.PI)*220:0),55,55,1,color,fade*(1-i/9));
      }return;
    }
    if(id==='lightStrike'||id==='starfall'||id==='cull'){
      const hit=id==='cull'?end:p,color=id==='starfall'?C.iceWhite:id==='cull'?C.red:C.gold;
      if(id==='starfall'){
        const z=this.ground(hit.x,hit.y)+40+(1-clamp(age/.4))*650;
        this.add('star',hit.x,hit.y,z,32,32,1,color,fade,age*4);this.line(new THREE.Vector3(hit.x,hit.y,z),new THREE.Vector3(hit.x-80,hit.y+60,z+180),14,C.ice,fade);
      }else for(let i=0;i<7;i++){
        const a=i*Math.PI*2/7,r=radius*.6,x=hit.x+Math.cos(a)*r,y=hit.y+Math.sin(a)*r;
        if(id==='lightStrike')this.add('flame',x,y,this.ground(x,y)+150,90,300*Math.sin(age*Math.PI),1,0xffe7ad,fade,0,this.billboard);
        else this.add('shard',x,y,this.ground(x,y)+120,25,25,180*Math.sin(age*Math.PI),color,fade);
      }
      this.burst(hit,Math.max(140,radius),color,age,e.id);return;
    }
    if(id==='slash'){
      this.ring(end,120,15,C.white,fade,110,Math.PI*1.4,age*8+e.id,false);this.burst(end,90,C.gold,age,e.id);return;
    }
    if(id==='hook'){
      const tip={x:p.x+(end.x-p.x)*clamp(age*3),y:p.y+(end.y-p.y)*clamp(age*3)};
      this.line(this.at(tip,100),this.at(end,100),7,0xb3a887,fade,true);this.burst(tip,95,C.red,age,e.id);return;
    }
    if(id==='manaVoid'||id==='manaBreak'||id==='hex'||id==='sprout'){
      const hit=e.stage==='cast'?end:p,color=id==='sprout'?C.green:C.violet;
      this.burst(hit,Math.max(130,radius),color,age,e.id);
      if(id==='manaVoid'){const size=Math.max(5,radius*(1-age));this.add('orb',hit.x,hit.y,this.ground(hit.x,hit.y)+80,size,size,size,C.violet,fade*.18);}
      return;
    }
    // Ice nova, frost blast, frost arrows and freeze use crystalline impacts.
    this.burst(e.stage==='cast'?end:p,Math.max(100,radius),C.ice,age,e.id,true);
  }

  private persistent(s:AbilityVisual,sim:BattleSimulation){
    const u=sim.unit(s.source);if(!u)return;
    if(u.hp<=0&&!['serpentWard','hook','arrow','lightStrike'].includes(s.kind))return;
    this.live++;const p={x:s.x??u.x,y:s.y??u.y},z=this.ground(p.x,p.y),t=this.time,fade=clamp((s.until-t)*4);
    switch(s.kind){
      case'hook':{
        const from=this.at(u,105),tip=this.at(p,105),length=from.distanceTo(tip),count=Math.min(40,Math.ceil(length/26));
        for(let i=0;i<count;i++){const a=from.clone().lerp(tip,i/count),b=from.clone().lerp(tip,(i+.72)/count);this.line(a,b,7,i%2?0xd5c7a1:0x6c6757,1,true);}
        this.ring(p,25,9,0xd8c9b2,1,105,Math.PI*1.65,Math.atan2(s.direction!.y,s.direction!.x),false);return;
      }
      case'arrow':this.arrow(p,s.direction!,C.iceWhite,1);return;
      case'lightStrike':{
        const charge=1-clamp((s.until-t)/.6);this.ring(p,s.radius,5,C.gold,.55+charge*.4);this.ring(p,s.radius*(1-charge*.85),3,C.fire,.75);return;
      }
      case'teleport':{
        for(const point of [p,s.point!]){this.ring(point,125,8,C.green,fade);this.ring(point,75,5,C.white,fade,15,Math.PI*1.65,t*2);for(let i=0;i<8;i++){const a=i*Math.PI/4+t,h=((t*.7+i/8)%1)*240;this.add('star',point.x+Math.cos(a)*85,point.y+Math.sin(a)*85,this.ground(point.x,point.y)+h,12,12,1,C.green,fade*.7,a);}}return;
      }
      case'dismember':{
        const v=sim.unit(s.target??null);if(!v||v.hp<=0)return;this.bolt(p,v,C.red,.25,Math.floor(t*4),100);this.ring(v,80,8,C.red,.7,90,Math.PI*1.7,t*3,false);return;
      }
      case'multishot':this.ring(p,65,4,C.ice,fade,20,Math.PI*1.5,u.facing-Math.PI*.75);return;
      case'serpentWard':{
        for(const [ox,oy]of [[-70,-70],[70,-70],[-70,70],[70,70]]){
          const x=p.x+ox,y=p.y+oy,base=this.ground(x,y),a=t*2+ox;
          this.add('rock',x,y,base+25,30,30,30,0x67533a,fade);
          for(let i=0;i<5;i++)this.add('rock',x+Math.sin(a+i*.8)*8,y,base+55+i*18,13-i,13-i,15,0x93b75b,fade,i*.5);
          this.add('rock',x+Math.sin(a+4)*8,y,base+145,26,18,18,0xb1d46d,fade,a);
          this.add('glow',x,y-12,base+150,45,45,1,C.green,fade*.8);
        }this.ring(p,135,4,C.green,fade*.45);return;
      }
      case'rot':{
        this.ring(p,s.radius,5,C.poison,.4*fade);
        for(let i=0;i<18;i++){const a=i*2.399+t*.7,r=s.radius*(.25+noise(i)*.7),h=((t*.38+i/18)%1)*140;this.add('glow',p.x+Math.cos(a)*r,p.y+Math.sin(a)*r,z+h+15,95,95,1,i%3?C.poison:0x4d7c36,.28*fade);}
        return;
      }
      case'frostShield':{
        for(let i=0;i<6;i++){const a=i*Math.PI/3+t*.8;this.add('shard',p.x+Math.cos(a)*80,p.y+Math.sin(a)*80,z+95,18,18,60,C.ice,fade*.6,a);}this.ring(p,90,4,C.iceWhite,fade*.7);return;
      }
      default:{
        const color=s.kind==='manaBreak'?C.violet:s.kind==='enchant'?C.gold:C.ice;
        this.ring(p,65,4,color,fade*.7,22,Math.PI*1.7,t*2);
        for(let i=0;i<5;i++){const a=i*Math.PI*2/5+t*2;this.add('star',p.x+Math.cos(a)*55,p.y+Math.sin(a)*55,z+80+Math.sin(a*2)*35,10,10,1,color,fade*.8,a);}return;
      }
    }
  }

  private unitState(u:CombatUnit,sim:BattleSimulation){
    if(u.hp<=0||u.kind==='tower'||u.kind==='base')return;
    const t=sim.time,z=this.ground(u.x,u.y),head=u.kind==='hero'?245:170;
    if(u.stunUntil>t){
      this.controls++;const fade=clamp((u.stunUntil-t)*8);
      this.ring(u,39,3,C.gold,fade*.65,head,Math.PI*2,t,false);
      for(let i=0;i<3;i++){const a=t*3.7+i*Math.PI*2/3;this.add('star',u.x+Math.cos(a)*44,u.y+Math.sin(a)*44,z+head+Math.sin(a*2)*9,17,17,1,C.gold,fade,-a);}
    }else if(u.rootUntil>t){
      this.controls++;for(let i=0;i<6;i++){const a=i*Math.PI/3;this.line(new THREE.Vector3(u.x+Math.cos(a)*55,u.y+Math.sin(a)*55,z+10),new THREE.Vector3(u.x+Math.cos(a+.3)*40,u.y+Math.sin(a+.3)*40,z+95),6,C.violet,.75);}
    }else if(u.tauntUntil>t||sim.extraAbilities.isSilenced(u,t)){
      this.controls++;const color=u.tauntUntil>t?C.red:C.violet;
      this.line(new THREE.Vector3(u.x,u.y,z+head),new THREE.Vector3(u.x,u.y,z+head+38),8,color,.9);this.add('orb',u.x,u.y,z+head-15,6,6,6,color,.9);
    }
    if(sim.itemRecoveryRemaining(u)>0){
      this.live++;this.ring(u,60,3,C.green,.35);
      for(let i=0;i<6;i++){const a=i*Math.PI/3+t*.8,h=((t*.45+i/6)%1)*135;this.add('glow',u.x+Math.cos(a)*42,u.y+Math.sin(a)*42,z+20+h,24,24,1,C.green,.55*(1-h/160));}
    }
    if(u.spinUntil>t){this.live++;for(let i=0;i<3;i++)this.ring(u,120+i*23,7,i?C.red:C.white,.7,75+i*13,Math.PI*1.2,t*13+i*2,false);}
    if(u.stormUntil>t){this.live++;this.ring(u,500,5,C.ice,.5);for(let i=0;i<16;i++){const a=i*2.399,r=85+noise(i)*380,x=u.x+Math.cos(a)*r,y=u.y+Math.sin(a)*r,h=(1-((t*1.3+i/16)%1))*400;this.add('shard',x,y,this.ground(x,y)+h,10,10,28,C.iceWhite,.7);}}
    if(u.invulnerableUntil>t){this.live++;this.ring(u,95,9,C.gold,.7,90,Math.PI*1.8,t*12,false);}
  }

  update(sim:BattleSimulation,camera?:THREE.Camera){
    if(camera)this.billboard.copy(camera.quaternion);
    this.time=sim.time;this.live=0;this.controls=0;this.dropped=0;
    for(const b of this.batches.values())b.mesh.count=0;
    this.flashes=this.flashes.filter(f=>this.time-f.start<f.duration&&this.time>=f.start);
    for(const f of this.flashes)this.transient(f);
    for(const s of sim.extraAbilities.visuals(sim.time))this.persistent(s,sim);
    for(const w of sim.wards)if(w.until>sim.time){this.live++;this.ring(w,400,4,C.green,.4);for(let i=0;i<8;i++){const a=i*Math.PI/4,r=160+Math.sin(this.time*2+i)*80;this.add('glow',w.x+Math.cos(a)*r,w.y+Math.sin(a)*r,this.ground(w.x,w.y)+((this.time+i*.17)%1)*130,50,50,1,C.green,.45);}}
    for(const u of sim.units)this.unitState(u,sim);
    for(const b of this.batches.values()){b.mesh.visible=b.mesh.count>0;b.mesh.instanceMatrix.needsUpdate=true;b.mesh.instanceColor!.needsUpdate=true;b.alpha.needsUpdate=true;}
  }
  get diagnostics(){return {casts:this.spawned,bySkill:{...this.bySkill},transients:this.flashes.length,persistent:this.live,controlMarkers:this.controls,instances:[...this.batches.values()].reduce((n,b)=>n+b.mesh.count,0),drawCalls:[...this.batches.values()].filter(b=>b.mesh.count>0).length,dropped:this.dropped};}
  clear(){this.flashes=[];this.time=0;this.live=0;this.controls=0;this.dropped=0;this.spawned=0;this.bySkill={};for(const b of this.batches.values()){b.mesh.count=0;b.mesh.visible=false;}}
  dispose(){this.clear();for(const b of this.batches.values()){b.mesh.geometry.dispose();(b.mesh.material as THREE.Material).dispose();b.mesh.dispose();}this.flameTexture.dispose();this.batches.clear();this.root.removeFromParent();}
}
