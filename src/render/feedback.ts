import * as THREE from 'three';
import { terrainHeight } from '../game/map';
import type { GameEvent, GameState, Unit } from '../game/types';

export class Feedback {
  readonly labels=document.createElement('div');
  private health=new Map<string,HTMLElement>();
  private popups:{element:HTMLElement;x:number;z:number;age:number;life:number;y:number}[]=[];
  private rings:{mesh:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>;age:number;life:number}[]=[];
  private beams:{line:THREE.Line;age:number}[]=[];
  private eventId=0;
  private position=new THREE.Vector3();
  private selection:THREE.Mesh;
  private heroRing:THREE.Mesh;
  constructor(private scene:THREE.Scene,container:HTMLElement){
    this.labels.id='unit-labels';container.append(this.labels);
    const makeRing=(color:number,radius:number)=>{const m=new THREE.Mesh(new THREE.RingGeometry(radius,radius+.09,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.renderOrder=3;scene.add(m);return m;};
    this.selection=makeRing(0xe6c884,1.1);this.heroRing=makeRing(0x6ce0b4,.91);
  }
  reset(){this.eventId=0;this.popups.forEach(p=>p.element.remove());this.popups=[];this.rings.forEach(r=>this.removeRing(r.mesh));this.rings=[];this.beams.forEach(b=>this.removeBeam(b.line));this.beams=[];}
  private removeRing(mesh:THREE.Mesh){mesh.removeFromParent();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
  private removeBeam(line:THREE.Line){line.removeFromParent();line.geometry.dispose();(line.material as THREE.Material).dispose();}
  update(state:GameState,camera:THREE.Camera,dt:number,width:number,height:number,onEvent:(event:GameEvent)=>void){
    const project=(x:number,y:number,z:number)=>{this.position.set(x,y,z).project(camera);return {x:(this.position.x*.5+.5)*width,y:(-.5*this.position.y+.5)*height,visible:this.position.z<1&&this.position.z>-1};};
    for(const unit of state.units){
      let el=this.health.get(unit.id);
      if(!el){el=document.createElement('div');el.className=`unit-health ${unit.team}`;el.innerHTML='<span class="unit-health-name"></span><div class="unit-health-track"><i></i></div>';this.health.set(unit.id,el);this.labels.append(el);}
      const p=project(unit.x,terrainHeight(unit.x,unit.z)+(unit.kind==='tower'?8.4:3.6),unit.z);
      el.hidden=!p.visible||unit.hp<=0;
      el.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
      (el.querySelector('i') as HTMLElement).style.width=`${unit.hp/unit.maxHp*100}%`;
      el.classList.toggle('selected',state.selectedId===unit.id||state.hoveredId===unit.id);
      (el.firstElementChild as HTMLElement).textContent=state.selectedId===unit.id||state.hoveredId===unit.id?unit.name:'';
    }
    const hero=state.units.find(u=>u.id===state.heroId)!;
    this.heroRing.position.set(hero.x,terrainHeight(hero.x,hero.z)+.065,hero.z);this.heroRing.visible=hero.hp>0;
    const selected=state.units.find(u=>u.id===(state.hoveredId||state.selectedId));
    this.selection.visible=!!selected&&selected.hp>0&&selected.id!==hero.id;
    if(selected){this.selection.position.set(selected.x,terrainHeight(selected.x,selected.z)+.07,selected.z);this.selection.scale.setScalar(selected.kind==='tower'?2.2:1);(this.selection.material as THREE.MeshBasicMaterial).color.set(selected.team==='enemy'?0xf6a17b:0xe6c884);}
    for(const event of state.events){if(event.id<=this.eventId)continue;this.eventId=event.id;onEvent(event);this.spawn(event,state.units);}
    for(const popup of this.popups){popup.age+=dt;const p=project(popup.x,terrainHeight(popup.x,popup.z)+popup.y+popup.age*2.6,popup.z);popup.element.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;popup.element.style.opacity=String(Math.min(1,(popup.life-popup.age)*3));}
    this.popups=this.popups.filter(p=>{if(p.age>p.life){p.element.remove();return false;}return true;});
    for(const ring of this.rings){ring.age+=dt;ring.mesh.scale.setScalar(1+ring.age*1.8);ring.mesh.material.opacity=Math.max(0,1-ring.age/ring.life);}
    this.rings=this.rings.filter(r=>{if(r.age>r.life){this.removeRing(r.mesh);return false;}return true;});
    for(const beam of this.beams){beam.age+=dt;(beam.line.material as THREE.LineBasicMaterial).opacity=Math.max(0,1-beam.age/.22);}
    this.beams=this.beams.filter(b=>{if(b.age>.22){this.removeBeam(b.line);return false;}return true;});
  }
  private spawn(e:GameEvent,units:Unit[]){
    if(e.type==='command'||e.type==='hit'||e.type==='kill'){
      const color=e.team==='enemy'?0xff8f70:0xb0e2ac;
      const ring=new THREE.Mesh(new THREE.RingGeometry(e.type==='command'?.45:.25,e.type==='command'?.55:.4,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2;ring.position.set(e.x,terrainHeight(e.x,e.z)+.1,e.z);this.scene.add(ring);this.rings.push({mesh:ring,age:0,life:e.type==='command'?.8:.32});
    }
    if(e.type==='hit'||e.type==='kill'){
      const element=document.createElement('span');element.className=`damage-popup ${e.type==='kill'?'reward':e.team==='enemy'?'received':''}`;
      element.textContent=e.type==='kill'?'+ '+(e.targetId==='enemy-tower'?'200':'45'):String(e.amount);
      if(e.type==='kill'&&e.team!=='allied')return;
      this.labels.append(element);this.popups.push({element,x:e.x,z:e.z,y:3.4,age:0,life:.9});
    }
    if(e.type==='attack'){
      const source=units.find(u=>u.id===e.sourceId),target=units.find(u=>u.id===e.targetId);
      if(source?.kind==='tower'&&target){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(source.x,terrainHeight(source.x,source.z)+7.2,source.z),new THREE.Vector3(target.x,terrainHeight(target.x,target.z)+1.8,target.z)]),new THREE.LineBasicMaterial({color:source.team==='enemy'?0xffb381:0x91def2,transparent:true,opacity:1}));this.scene.add(line);this.beams.push({line,age:0});}
    }
  }
  dispose(){this.reset();this.labels.remove();this.health.clear();this.removeRing(this.selection);this.removeRing(this.heroRing);}
}
