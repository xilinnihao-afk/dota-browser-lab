import * as THREE from 'three';
import type {model} from 'war3-model';
import {sampleNumber,type AnimationClock} from './animation';

export function particleEnvelope(source:model.ParticleEmitter2,age:number){
  const t=THREE.MathUtils.clamp(age/Math.max(.001,source.LifeSpan??1),0,1),split=source.Time??.5;
  const segment=t<split?0:1,phase=THREE.MathUtils.clamp(segment===0?t/Math.max(.00001,split):(t-split)/Math.max(.00001,1-split),0,1);
  const mix=(a:number,b:number)=>a+(b-a)*phase;
  const a=source.SegmentColor?.[segment]??[1,1,1],b=source.SegmentColor?.[segment+1]??a;
  return {segment,phase,scale:mix(source.ParticleScaling?.[segment]??1,source.ParticleScaling?.[segment+1]??1),color:[mix(a[0],b[0]),mix(a[1],b[1]),mix(a[2],b[2]),mix(source.Alpha?.[segment]??255,source.Alpha?.[segment+1]??255)/255]};
}
export function particleCell(interval:ArrayLike<number>|undefined,phase:number,cells:number){
  if(!interval)return 0;const count=interval[1]-interval[0];
  return THREE.MathUtils.clamp(interval[0]+(count>0?Math.floor(count*interval[2]*phase)%count:0),0,Math.max(0,cells-1));
}
export function seededRandom(seed:number){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
interface Particle {position:THREE.Vector3;velocity:THREE.Vector3;age:number;gravity:number;scale:THREE.Vector3;facing:number;}
const STEP=1/60;
/** Native PRE2 simulation: fixed-step, seeded, pooled, one draw per emitter.
 * Vertices are world-space; inverse root transform prevents double transforms. */
export class NativeParticles {
  readonly mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial|THREE.MeshLambertMaterial>;
  readonly capacity:number;
  readonly particles:Particle[]=[];
  dropped=0;
  private spare:Particle[]=[];
  private rng:()=>number;
  private carry=0;
  private emission=0;
  private lastSquirt='';
  private readonly position:THREE.BufferAttribute;
  private readonly uv:THREE.BufferAttribute;
  private readonly color:THREE.BufferAttribute;
  private readonly normal:THREE.BufferAttribute;
  private readonly world=new THREE.Matrix4();
  private readonly lastCamera=new THREE.Matrix4();
  private readonly lastRoot=new THREE.Matrix4();
  private readonly lastEmitter=new THREE.Matrix4();
  private redraw=true;
  private readonly rotation=new THREE.Quaternion();
  private readonly scale=new THREE.Vector3();
  private readonly pos=new THREE.Vector3();
  private readonly right=new THREE.Vector3();
  private readonly up=new THREE.Vector3();
  private readonly forward=new THREE.Vector3();
  private readonly center=new THREE.Vector3();
  private readonly end=new THREE.Vector3();
  private readonly edge=new THREE.Vector3();
  private readonly vertex=new THREE.Vector3();
  private readonly axisX=new THREE.Vector3(1,0,0);
  private readonly axisY=new THREE.Vector3(0,1,0);
  private readonly axisZ=new THREE.Vector3(0,0,1);
  private readonly direction=new THREE.Quaternion();
  private readonly scratch=new THREE.Quaternion();
  constructor(readonly source:model.ParticleEmitter2,textures:THREE.Texture[],private seed=1){
    const rate=source.EmissionRate,peak=typeof rate==='number'?rate:Math.max(0,...(rate?.Keys.map(k=>k.Vector[0])??[]));
    this.capacity=Math.min(2048,Math.max(8,Math.ceil(peak*Math.max(source.LifeSpan??1,1))+8));
    this.rng=seededRandom(seed);
    const quads=this.capacity*((source.FrameFlags&1?1:0)+(source.FrameFlags&2?1:0));
    const geometry=new THREE.BufferGeometry(),indices:number[]=[];
    this.position=new THREE.BufferAttribute(new Float32Array(quads*12),3).setUsage(THREE.DynamicDrawUsage);
    this.normal=new THREE.BufferAttribute(new Float32Array(quads*12),3).setUsage(THREE.DynamicDrawUsage);
    this.color=new THREE.BufferAttribute(new Float32Array(quads*16),4).setUsage(THREE.DynamicDrawUsage);
    this.uv=new THREE.BufferAttribute(new Float32Array(quads*8),2).setUsage(THREE.DynamicDrawUsage);
    for(let i=0;i<quads;i++){const n=i*4;indices.push(n,n+1,n+2,n,n+2,n+3);}
    geometry.setAttribute('position',this.position);geometry.setAttribute('normal',this.normal);geometry.setAttribute('color',this.color);geometry.setAttribute('uv',this.uv);geometry.setIndex(indices);geometry.setDrawRange(0,0);
    const mode=source.FilterMode??0,settings={map:textures[source.TextureID??0]??null,vertexColors:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,alphaTest:mode===4?.75:0,toneMapped:false};
    const material=source.Flags&32768?new THREE.MeshBasicMaterial(settings):new THREE.MeshLambertMaterial(settings);
    material.forceSinglePass=true;
    if(mode>=1&&mode<=3){material.blending=THREE.CustomBlending;material.blendEquation=THREE.AddEquation;
      material.blendSrc=mode===1?THREE.SrcAlphaFactor:mode===2?THREE.ZeroFactor:THREE.DstColorFactor;
      material.blendDst=mode===1?THREE.OneFactor:THREE.SrcColorFactor;material.blendSrcAlpha=THREE.ZeroFactor;material.blendDstAlpha=THREE.OneFactor;}
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name=`PRE2/${source.Name}`;this.mesh.frustumCulled=false;this.mesh.matrixAutoUpdate=false;this.mesh.renderOrder=30+(source.PriorityPlane??0);
    for(let i=0;i<this.capacity;i++)this.spare.push({position:new THREE.Vector3(),velocity:new THREE.Vector3(),age:0,gravity:0,scale:new THREE.Vector3(1,1,1),facing:0});
  }
  reset(seed=this.seed){this.seed=seed;this.rng=seededRandom(seed);this.redraw=true;this.spare.push(...this.particles);this.particles.length=0;this.carry=this.emission=0;this.lastSquirt='';this.dropped=0;this.mesh.geometry.setDrawRange(0,0);}
  private spawn(clock:AnimationClock){
    const p=this.spare.pop();if(!p){this.dropped++;return;}
    const s=this.source,r=()=>this.rng()*2-1,modelSpace=!!(s.Flags&524288);
    p.age=0;p.position.fromArray(s.PivotPoint);p.position.x+=r()*sampleNumber(s.Width,clock,0)*.5;p.position.y+=r()*sampleNumber(s.Length,clock,0)*.5;
    const latitude=sampleNumber(s.Latitude,clock,0)*Math.PI/180;
    this.direction.setFromAxisAngle(this.axisZ,Math.PI/2).multiply(this.scratch.setFromAxisAngle(this.axisY,r()*latitude));
    if(!(s.Flags&131072))this.direction.multiply(this.scratch.setFromAxisAngle(this.axisX,r()*latitude));
    if(!modelSpace)this.direction.premultiply(this.rotation);
    p.velocity.set(0,0,1).applyQuaternion(this.direction).multiplyScalar(sampleNumber(s.Speed,clock,0)*(1+r()*sampleNumber(s.Variation,clock,0)));
    p.scale.copy(this.scale);p.gravity=sampleNumber(s.Gravity,clock,0)*(modelSpace?1:this.scale.z);
    if(!modelSpace){p.position.applyMatrix4(this.world);p.velocity.multiply(this.scale);}
    p.facing=Math.atan2(p.velocity.y,p.velocity.x)-Math.PI+Math.PI/8;
    this.particles.push(p);
  }
  update(delta:number,clock:AnimationClock,node:THREE.Matrix4,root:THREE.Object3D,camera?:THREE.Camera){
    this.world.multiplyMatrices(root.matrixWorld,node);this.world.decompose(this.pos,this.rotation,this.scale);
    let advanced=false;this.carry+=Math.max(0,delta);
    while(this.carry+1e-9>=STEP){
      this.carry-=STEP;advanced=true;
      const duration=Math.max(1,clock.interval[1]-clock.interval[0]),elapsed=Math.max(0,clock.elapsed-this.carry*1000);
      const local=clock.frame-clock.interval[0]-this.carry*1000;
      const sample={...clock,elapsed,frame:clock.interval[0]+(clock.nonLooping?THREE.MathUtils.clamp(local,0,duration):(local%duration+duration)%duration)};
      for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.age+=STEP;
        if(p.age>=(this.source.LifeSpan??1)){this.spare.push(p);this.particles[i]=this.particles[this.particles.length-1];this.particles.pop();continue;}
        p.position.addScaledVector(p.velocity,STEP);p.position.z-=.5*p.gravity*STEP*STEP;p.velocity.z-=p.gravity*STEP;
      }
      if(sampleNumber(this.source.Visibility,sample,1)>.001){
        const rate=Math.max(0,sampleNumber(this.source.EmissionRate,sample,0));
        if(this.source.Squirt){const track=this.source.EmissionRate;
          const global=typeof track==='object'&&typeof track.GlobalSeqId==='number',period=global?(clock.globalSequences[(track as model.AnimVector).GlobalSeqId!]??0):duration;
          const frame=global?(period>0?elapsed%period:Infinity):sample.frame,from=global?0:sample.interval[0];
          const key=typeof track==='object'?track.Keys.filter(k=>k.Frame>=from&&k.Frame<=frame).at(-1)?.Frame:0;
          const stamp=`${!global&&clock.nonLooping?0:period>0?Math.floor(elapsed/period):0}:${key}`;
          if(key!==undefined&&stamp!==this.lastSquirt){this.emission+=rate;this.lastSquirt=stamp;}
        }else this.emission+=rate*STEP;
        const count=Math.floor(this.emission+1e-8);this.emission-=count;for(let i=0;i<count;i++)this.spawn(sample);
      }
    }
    const cameraChanged=!!camera&&this.lastCamera.elements.some((v,i)=>Math.abs(v-camera.matrixWorld.elements[i])>1e-6);
    const rootChanged=!this.lastRoot.equals(root.matrixWorld),emitterChanged=!!(this.source.Flags&524288)&&!this.lastEmitter.equals(this.world);
    if(this.redraw||advanced||cameraChanged||rootChanged||emitterChanged){this.draw(root,camera);this.redraw=false;this.lastRoot.copy(root.matrixWorld);this.lastEmitter.copy(this.world);if(camera)this.lastCamera.copy(camera.matrixWorld);}
  }
  private draw(root:THREE.Object3D,camera?:THREE.Camera){
    const s=this.source,modelSpace=!!(s.Flags&524288),rows=Math.max(1,s.Rows??1),cols=Math.max(1,s.Columns??1);
    this.mesh.matrix.copy(root.matrixWorld).invert();
    const e=camera?.matrixWorld.elements;
    this.right.set(e?.[0]??1,e?.[1]??0,e?.[2]??0);this.up.set(e?.[4]??0,e?.[5]??1,e?.[6]??0);this.forward.crossVectors(this.right,this.up).normalize();
    if(s.Flags&65536&&camera)this.particles.sort((a,b)=>b.position.distanceToSquared(camera.position)-a.position.distanceToSquared(camera.position));
    let quad=0;
    for(const p of this.particles){
      const env=particleEnvelope(s,p.age);this.center.copy(p.position);if(modelSpace)this.center.applyMatrix4(this.world);
      for(const tail of [false,true]){
        if(!(s.FrameFlags&(tail?2:1)))continue;
        const interval=tail?(env.segment?s.TailDecayUVAnim:s.TailUVAnim):(env.segment?s.DecayUVAnim:s.LifeSpanUVAnim),cell=particleCell(interval,env.phase,rows*cols),u=(cell%cols)/cols,v=Math.floor(cell/cols)/rows;
        const xScale=env.scale*(modelSpace?this.scale.x:p.scale.x),yScale=env.scale*(modelSpace?this.scale.y:p.scale.y);
        if(tail){this.end.copy(p.position).addScaledVector(p.velocity,-(s.TailLength??0));if(modelSpace)this.end.applyMatrix4(this.world);this.edge.subVectors(this.end,this.center).cross(this.forward).normalize().multiplyScalar(xScale);}
        for(let i=0;i<4;i++){
          const x=i===0||i===3?1:-1,y=i<2?1:-1;
          if(tail)this.vertex.copy(i===0||i===3?this.center:this.end).addScaledVector(this.edge,i<2?-1:1);
          else if(s.Flags&1048576){const cs=Math.cos(p.facing),sn=Math.sin(p.facing);this.vertex.copy(this.center).addScaledVector(this.axisX,(x*cs-y*sn)*xScale).addScaledVector(this.axisY,(x*sn+y*cs)*yScale);}
          else this.vertex.copy(this.center).addScaledVector(this.right,x*xScale).addScaledVector(this.up,y*yScale);
          const n=quad*4+i;this.position.setXYZ(n,this.vertex.x,this.vertex.y,this.vertex.z);this.normal.setXYZ(n,this.forward.x,this.forward.y,this.forward.z);
          this.uv.setXY(n,u+(x>0?1/cols:0),v+(y>0?0:1/rows));this.color.setXYZW(n,env.color[0],env.color[1],env.color[2],env.color[3]);
        }quad++;
      }
    }
    this.mesh.geometry.setDrawRange(0,quad*6);this.mesh.visible=quad>0;
    if(quad){for(const a of[this.position,this.normal,this.color,this.uv]){a.clearUpdateRanges();a.addUpdateRange(0,quad*4*a.itemSize);a.needsUpdate=true;}}
  }
  dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh.removeFromParent();this.particles.length=this.spare.length=0;}
}
