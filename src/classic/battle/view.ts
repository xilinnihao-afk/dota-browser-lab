import {labelBounds,labelVisible} from './label-layout';
import {gameRect} from '../viewport';
import {gameViewport} from '../viewport';
import * as THREE from 'three';
import {loadModel,loadTexture,modelTextures,textureDataUrl} from '../assets';
import {NativeModel} from '../native-model';
import {heightAt,type MapData,type Placement} from '../map-data';
import {assets,type ModelId} from './definitions';
import type {BattleSimulation,CombatUnit,CombatEvent} from './simulation';
import type {ShopLocation} from './world';
import {AttackEffects} from './attack-effects';
import {SkillEffects,controlLabel} from './skill-effects';
interface Actor {native:NativeModel;ring:THREE.Mesh;shadow:THREE.Mesh;splat?:THREE.Mesh;bar:HTMLButtonElement;fill:HTMLElement;label:HTMLElement;sequence:string;serial:number;model:ModelId;placement?:Placement;animationRate:number}
export async function createBattleView(map:MapData,scene:THREE.Scene,app:HTMLElement,light:(root:THREE.Object3D)=>void,onSelect:(id:string)=>void,shops:ShopLocation[]=[],onShop:()=>void=()=>{}){
  const prepared=new Map<string,{source:Awaited<ReturnType<typeof loadModel>>;textures:THREE.Texture[]}>();
  const placementKey=(id:string,p:Placement)=>id+'/'+p.team+'/'+JSON.stringify(p.replacements);
  await Promise.all(Object.entries(assets.models).map(async([id,path])=>{const source=await loadModel(path);for(const team of [0,1,2])prepared.set(id+'/'+team,{source,textures:await modelTextures(source,team===2?12:team)});
    for(const p of map.placements)if(p.kind==='unit'&&p.model===path){const key=placementKey(id,p);if(!prepared.has(key))prepared.set(key,{source,textures:await modelTextures(source,p.team,p.replacements)});}
  }));
  const effects=new Map<string,{source:Awaited<ReturnType<typeof loadModel>>;textures:THREE.Texture[]}>(),projectileSources=new Map<string,{source:Awaited<ReturnType<typeof loadModel>>;textures:THREE.Texture[]}>();
  // Frost nova and the frost missile have the same catalog key but different
  // original MDX files. Keep contact effects separate from flying projectiles.
  await Promise.all([...Object.entries(assets.effects).map(async([id,path])=>{const source=await loadModel(path);effects.set(id,{source,textures:await modelTextures(source,0)});}),...Object.entries(assets.missiles).map(async([id,path])=>{const source=await loadModel(path);projectileSources.set(id,{source,textures:await modelTextures(source,0)});})]);
  const splatTextures=new Map<string,THREE.Texture>();
  await Promise.all([...new Set(map.placements.filter(p=>Object.values(assets.models).some(path=>path===p.model)&&p.splat).map(p=>p.splat!.path))].map(async path=>splatTextures.set(path,await loadTexture(path))));
  const icons=Object.fromEntries(await Promise.all(Object.entries(assets.icons).map(async([key,path])=>[key,textureDataUrl(await loadTexture(path))])));
  const [circle,shadowTexture,glow]=await Promise.all([loadTexture('replaceabletextures/selection/selectioncirclelarge.blp'),loadTexture('replaceabletextures/shadows/shadow.blp'),loadTexture('textures/genericglow2c.blp')]);
  const root=new THREE.Group();scene.add(root);const overlays=document.createElement('div');overlays.className='battle-world-labels';app.append(overlays);
  const actors=new Map<string,Actor>(),bursts:{actor:NativeModel;key:string;life:number;duration:number;rate:number}[]=[],texts:{element:HTMLElement;point:THREE.Vector3;life:number}[]=[];
  const attackEffects=new AttackEffects(root,glow);const counters={attacks:0,impacts:0,frostMissiles:0,frostImpacts:0};
  const skillEffects=new SkillEffects(root,(x,y)=>heightAt(map,x,y),glow);
  const plane=new THREE.PlaneGeometry(1,1),shadowMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.48,depthWrite:false,toneMapped:false});
  const missileMats=[0x86daed,0xeaa187].map(color=>new THREE.SpriteMaterial({map:glow,color,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  const missiles=new Map<number,{object:THREE.Object3D;native?:NativeModel}>();const position=new THREE.Vector3();
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),bounds=new THREE.Sphere();
  const aimLineGeometry=new THREE.BufferGeometry();aimLineGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const aimLine=new THREE.Line(aimLineGeometry,new THREE.LineBasicMaterial({color:0x82dce8,transparent:true,opacity:.85,depthWrite:false}));aimLine.visible=false;root.add(aimLine);
  const aim=new THREE.Mesh(new THREE.RingGeometry(.975,1,64),new THREE.MeshBasicMaterial({color:0x78dcf5,transparent:true,opacity:.8,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));aim.visible=false;root.add(aim);
  const command=new THREE.Mesh(plane,new THREE.MeshBasicMaterial({map:circle,color:0x99ef68,transparent:true,depthWrite:false,toneMapped:false}));command.visible=false;root.add(command);let commandLife=0;
  function make(u:CombatUnit){const placement=u.sourceId?map.placements.find(p=>p.kind==='unit'&&p.id===u.sourceId&&Math.abs(p.position[0]-u.x)<1&&Math.abs(p.position[1]-u.y)<1):undefined;
    const data=prepared.get(placement?placementKey(u.model,placement):u.model+'/'+u.team)!;const native=NativeModel.fromParsed(data.source,data.textures);native.enableGpuSkinning();root.add(native.root);light(native.root);if(placement)native.tint.fromArray(placement.color);
    if(u.campId==='boss'){const source=map.placements.find(p=>p.id==='n00L'&&Math.abs(p.position[0]-2448)<1&&Math.abs(p.position[1]+528)<1);if(source)native.tint.setRGB(...source.color);}
    const ring=new THREE.Mesh(plane,new THREE.MeshBasicMaterial({map:circle,color:u.team===2?0xe7b85a:u.team?0xef5b4c:0x7aff59,transparent:true,depthWrite:false,toneMapped:false}));ring.renderOrder=30;root.add(ring);
    const shadow=new THREE.Mesh(plane,shadowMat);shadow.renderOrder=12;root.add(shadow);
    let splat:THREE.Mesh|undefined;
    if(placement?.splat){const diameter=placement.splat.scale*2,geo=new THREE.PlaneGeometry(diameter,diameter,4,4),positions=geo.getAttribute('position');for(let i=0;i<positions.count;i++){const x=positions.getX(i)+u.x,y=positions.getY(i)+u.y;positions.setXYZ(i,x,y,heightAt(map,x,y)+.65);}splat=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:splatTextures.get(placement.splat.path),transparent:true,depthWrite:false,toneMapped:false}));splat.renderOrder=11;root.add(splat);}
    const bar=document.createElement('button');bar.className='unit-bar '+(u.team===2?'neutral':u.team?'enemy':'ally')+(u.id==='hero'?' player':'');bar.dataset.unitId=u.id;bar.classList.add('unit-'+u.kind);bar.title=u.name;bar.setAttribute('aria-label',`${u.team?'攻击':'选择'}${u.team===2?'中立':u.team?'敌方':'己方'}${u.name} ${u.id}`);bar.innerHTML='<span class="unit-label"></span><span class="unit-health"><i></i></span>';bar.onclick=()=>onSelect(u.id);bar.oncontextmenu=e=>{e.preventDefault();bar.dispatchEvent(new CustomEvent('battle-attack',{bubbles:true,detail:u.id}));};overlays.append(bar);
    const actor:Actor={native,ring,shadow,splat,bar,fill:bar.querySelector('i')!,label:bar.querySelector<HTMLElement>('.unit-label')!,sequence:'',serial:-1,model:u.model,placement,animationRate:1};actors.set(u.id,actor);return actor;
  }
  const shopMarkers=shops.map(shop=>{const button=document.createElement('button');button.className='shop-marker';button.textContent='商店';button.setAttribute('aria-label',`打开地图商店 ${shop.id}`);button.onclick=onShop;overlays.append(button);return{shop,button};});
  const destroy=(a:Actor)=>{a.native.dispose();a.ring.removeFromParent();(a.ring.material as THREE.Material).dispose();a.shadow.removeFromParent();if(a.splat){a.splat.removeFromParent();a.splat.geometry.dispose();(a.splat.material as THREE.Material).dispose();}a.bar.remove();};
  function burst(event:CombatEvent){const key=event.effect;if(!key||!effects.has(key))return;
    const source=effects.get(key)!;let slot=bursts.find(b=>b.key===key&&b.life<=0);
    if(!slot){if(bursts.length>=40){const index=bursts.findIndex(b=>b.life<=0),old=bursts.splice(index<0?0:index,1)[0];old.actor.dispose();}
      const actor=NativeModel.fromParsed(source.source,source.textures);actor.enableGpuSkinning();root.add(actor.root);light(actor.root);slot={actor,key,life:0,duration:0,rate:1};bursts.push(slot);}
    const actor=slot.actor,isContact=event.kind==='impact';actor.root.visible=true;actor.setSequence(key==='ward'?'Stand':actor.sequences.some(s=>s.toLowerCase()==='birth')?'Birth':'Stand');
    actor.root.position.set(event.x,event.y,heightAt(map,event.x,event.y)+(isContact?(event.height??85):4));actor.root.rotation.z=event.direction??0;
    actor.root.scale.setScalar(key==='frost'?(event.radius??300)/220:key==='stomp'?(event.radius??300)/250:key==='impact'?(event.radius??120)/300:key==='vamp'?.7:key==='ward'?1:1.1);
    const duration=event.duration??(key==='ward'?5:isContact?.65:key==='blizzard'?1.1:key==='level'?2:1.6);slot.life=slot.duration=duration;
    slot.rate=key==='ward'?1:Math.max(.5,(actor.sequence.Interval[1]-actor.sequence.Interval[0])/1000/duration);
  }
  function event(e:CombatEvent){if(e.kind==='ability'){skillEffects.event(e);return;}if(e.kind==='command'){command.position.set(e.x,e.y,heightAt(map,e.x,e.y)+3);commandLife=.7;return;}
    if(e.kind==='attack'){counters.attacks++;return;}
    if(e.kind==='kill'&&e.target?.startsWith('base-'))burst({...e,kind:'impact',effect:'impact',height:140,radius:400});
    if(e.kind==='impact'){counters.impacts++;if(e.effect==='frost')counters.frostImpacts++;if(e.effect==='blade'||e.effect==='axe')attackEffects.impact(e.effect,e.x,e.y,heightAt(map,e.x,e.y)+(e.height??85),e.direction??actors.get(e.source??'')?.native.root.rotation.z??0);}
    // The nine added heroes now have skill-specific visuals. Keep original contact
    // accents, but remove their former generic nova/stomp/healing-ward stand-ins.
    if(!(e.kind==='spell'&&e.heroId&&!['juggernaut','axe','maiden'].includes(e.heroId)))burst(e);
    if(e.kind==='damage'||e.kind==='level'||e.kind==='gold'||(e.kind==='heal'&&e.text)){const element=document.createElement('span');element.className='combat-text '+e.kind;element.textContent=e.kind==='damage'?String(e.amount):e.text??'';overlays.append(element);texts.push({element,point:new THREE.Vector3(e.x,e.y,heightAt(map,e.x,e.y)+165),life:e.kind==='level'?2:1});if(texts.length>48)texts.shift()!.element.remove();}
  }
  let layoutWidth=0,layoutHeight=0,layoutPhase='',layoutClock=0,bounds2d={top:12,bottom:0};
  function update(sim:BattleSimulation,camera:THREE.Camera,dt:number,paused:boolean){
    // Recheck after selection/layout changes as well as resize. Mobile HUD uses
    // display:contents, whose empty box must never hide the entire battlefield.
    layoutClock-=dt;
    if(layoutWidth!==gameViewport.width||layoutHeight!==gameViewport.height||layoutPhase!==sim.phase||layoutClock<=0){
      layoutWidth=gameViewport.width;layoutHeight=gameViewport.height;layoutPhase=sim.phase;layoutClock=.25;
      const hud=app.querySelector('.classic-hud'),top=app.querySelector('.battle-top');
      bounds2d=labelBounds(layoutHeight,hud?gameRect(hud):null,top?gameRect(top):null);
    }
    const delta=paused?0:dt;camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));const active=new Set(sim.units.map(u=>u.id));
    for(const[id,a]of actors)if(!active.has(id)){destroy(a);actors.delete(id);}
    for(const u of sim.units){let a=actors.get(u.id);if(a&&a.model!==u.model){destroy(a);actors.delete(u.id);a=undefined;}a??=make(u);
      const z=heightAt(map,u.x,u.y),structure=u.kind==='tower'||u.kind==='base';a.native.root.position.set(u.x,u.y,z+(a.placement?.moveHeight??0));if(a.placement)a.native.root.scale.fromArray(a.placement.scale);else a.native.root.scale.setScalar(u.scale);a.native.root.rotation.z=a.placement?.angle??u.facing;
      bounds.center.set(u.x,u.y,z+(structure?200:100));bounds.radius=structure?800:280;const onScreen=frustum.intersectsSphere(bounds);
      a.native.root.visible=(u.hp>0||(sim.time-u.deadAt<2.4&&a.native.sequences.some(s=>/^death(?:\s|$)/i.test(s))))&&onScreen;
      let requested=u.hp<=0?'Death':u.spinUntil>sim.time?'Stand Spin':u.stormUntil>sim.time||sim.extraAbilities.isChanneling(u,sim.time)?'Spell Channel':u.action==='walk'?'Walk':u.action==='attack'?'Attack':u.action==='cast'?'Spell':'Stand';
      if(requested==='Spell'&&(u.heroId==='axe'||u.heroId==='earthshaker'))requested='Attack Slam';
      if((requested==='Spell'||requested==='Spell Channel')&&u.heroId==='pudge')requested='Stand Channel';
      if(requested==='Spell Channel'&&!a.native.sequences.some(s=>/spell.*channel/i.test(s)))requested='Spell';
      // A ziggurat's generic Attack lookup selects an upgraded geometry set.
      // Preserve the source map variant; its missile still shows each shot.
      if(a.placement&&structure){if(requested==='Stand')requested=a.placement.sequence;else if(requested==='Attack'){const attack=a.placement.sequence.replace(/^Stand/i,'Attack');requested=a.native.sequences.some(s=>s.toLowerCase()===attack.toLowerCase())?attack:a.placement.sequence;}}
      if(a.sequence!==requested||((requested.startsWith('Attack')||requested.startsWith('Spell'))&&a.serial!==u.actionSerial)){
        a.native.setSequence(requested);a.sequence=requested;a.serial=u.actionSerial;
        // Original attacks last 1–1.4s; simulation windup/contact/recovery are
        // 0.3/0.5s. Play the complete source animation during that action.
        a.animationRate=requested.startsWith('Attack')?(a.native.sequence.Interval[1]-a.native.sequence.Interval[0])/1000/Math.max(.1,u.actionUntil-sim.time):1;
      }
      if(a.native.root.visible)a.native.update(delta*(requested==='Walk'?u.speed/280:a.animationRate),camera);
      const size=u.kind==='base'?550:u.kind==='tower'?360:u.kind==='hero'?170:115;a.ring.position.set(u.x,u.y,z+2);a.ring.scale.set(size,size,1);a.ring.visible=u.hp>0&&onScreen&&(u.id==='hero'||u.id===sim.selectedId);
      a.shadow.position.set(u.x,u.y,z+.7);a.shadow.scale.set(size,size,1);a.shadow.visible=u.hp>0&&onScreen;if(a.splat)a.splat.visible=onScreen;
      position.set(u.x,u.y,z+(u.kind==='base'?400:u.kind==='tower'?280:u.kind==='hero'?220:160)).project(camera);const x=(position.x*.5+.5)*gameViewport.width,y=(-position.y*.5+.5)*gameViewport.height;
      const visible=labelVisible(u.hp,x,y,position.z,gameViewport.width,bounds2d);
      a.bar.hidden=!visible;if(visible){a.bar.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;a.fill.style.width=`${Math.max(0,Math.min(1,u.hp/u.maxHp))*100}%`;const status=controlLabel(u,sim.time,sim.extraAbilities.isSilenced(u,sim.time))||(u.id==='rival'&&sim.rivalMode==='retreat'?'回泉补给':u.id==='rival'&&sim.rivalMode==='recover'?'泉水恢复':u.id==='rival'&&sim.rivalMode==='evade'?'闪避':u.returning?'脱战返回':'');a.label.textContent=(u.kind==='hero'?`${u.name} · ${u.level}`:structure||u.kind==='neutral'?u.name:'')+(status?' '+status:'');a.bar.classList.toggle('selected',sim.selectedId===u.id);}
    }
    const ids=new Set(sim.projectiles.map(p=>p.id));for(const[id,m]of missiles)if(!ids.has(id)){m.native?.dispose();m.object.removeFromParent();missiles.delete(id);}
    for(const p of sim.projectiles){let missile=missiles.get(p.id);if(!missile){
      if(p.style){const data=projectileSources.get(p.style)!,native=NativeModel.fromParsed(data.source,data.textures);native.enableGpuSkinning();native.setSequence('Stand');native.root.scale.setScalar(p.style==='rock'?1.35:p.style==='frost'?.65:1.1);light(native.root);missile={object:native.root,native};if(p.style==='frost')counters.frostMissiles++;}
      else{const sprite=new THREE.Sprite(missileMats[p.team===0?0:1]);sprite.scale.set(50,50,1);missile={object:sprite};}
      root.add(missile.object);missiles.set(p.id,missile);
    }
      const target=sim.unit(p.target),source=sim.unit(p.source),remaining=target?Math.hypot(target.x-p.x,target.y-p.y):0,total=target&&source?Math.max(1,Math.hypot(target.x-source.x,target.y-source.y)):1,progress=Math.max(0,Math.min(1,1-remaining/total));
      const height=p.style==='rock'?200*(1-progress)+90*progress+Math.sin(progress*Math.PI)*180:p.style==='spirit'?180:100;
      missile.object.position.set(p.x,p.y,heightAt(map,p.x,p.y)+height);if(target)missile.object.rotation.z=Math.atan2(target.y-p.y,target.x-p.x);missile.native?.update(delta,camera);
    }
    for(const {shop,button}of shopMarkers){position.set(shop.x,shop.y,heightAt(map,shop.x,shop.y)+230).project(camera);const x=(position.x*.5+.5)*gameViewport.width,y=(-position.y*.5+.5)*gameViewport.height;button.hidden=position.z>1||position.z< -1||x<0||x>gameViewport.width||y<bounds2d.top||y>bounds2d.bottom;if(!button.hidden)button.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;}
    for(const b of bursts)if(b.life>0){b.life-=delta;if(b.life<=0)b.actor.root.visible=false;else b.actor.update(delta*b.rate,camera);}
    attackEffects.update(delta);
    skillEffects.update(sim,camera);
    for(let i=texts.length-1;i>=0;i--){const t=texts[i];t.life-=delta;if(t.life<=0){t.element.remove();texts.splice(i,1);continue;}t.point.z+=delta*45;position.copy(t.point).project(camera);t.element.style.transform=`translate(${(position.x*.5+.5)*gameViewport.width}px,${(-position.y*.5+.5)*gameViewport.height}px) translate(-50%,-50%)`;t.element.style.opacity=String(Math.min(1,t.life*2));}
    commandLife-=delta;command.visible=commandLife>0;if(command.visible){const size=80+(1-commandLife/.7)*60;command.scale.set(size,size,1);(command.material as THREE.MeshBasicMaterial).opacity=commandLife/.7;}
  }
  function clear(){actors.forEach(destroy);actors.clear();bursts.forEach(b=>b.actor.dispose());bursts.length=0;texts.forEach(t=>t.element.remove());texts.length=0;missiles.forEach(m=>{m.native?.dispose();m.object.removeFromParent();});missiles.clear();attackEffects.clear();skillEffects.clear();for(const key of Object.keys(counters)as (keyof typeof counters)[])counters[key]=0;commandLife=0;command.visible=false;aim.visible=false;aimLine.visible=false;}
  return {icons,root,actors,event,update,clear,setVisible(visible:boolean){root.visible=visible;overlays.hidden=!visible;},get diagnostics(){return {...counters,meleeContacts:attackEffects.spawned,activeAttackEffects:attackEffects.active,activeBursts:bursts.filter(b=>b.life>0).length,pooledBursts:bursts.length,activeMissiles:missiles.size,visibleActors:[...actors.values()].filter(a=>a.native.root.visible).length,skills:skillEffects.diagnostics};},setAim(p:{x:number;y:number}|null,radius=0,valid=true,from?:{x:number;y:number}){aim.visible=!!p;aimLine.visible=!!p&&!!from;if(p&&from){const pos=aimLineGeometry.getAttribute('position') as THREE.BufferAttribute;pos.setXYZ(0,from.x,from.y,heightAt(map,from.x,from.y)+10);pos.setXYZ(1,p.x,p.y,heightAt(map,p.x,p.y)+10);pos.needsUpdate=true;aimLineGeometry.computeBoundingSphere();(aimLine.material as THREE.LineBasicMaterial).color.setHex(valid?0x82dce8:0xe57562);}if(p){aim.position.set(p.x,p.y,heightAt(map,p.x,p.y)+4);aim.scale.set(radius,radius,1);(aim.material as THREE.MeshBasicMaterial).color.setHex(valid?0x82dce8:0xe57562);}},dispose(){clear();attackEffects.dispose();skillEffects.dispose();root.removeFromParent();overlays.remove();plane.dispose();shadowMat.dispose();missileMats.forEach(m=>m.dispose());aimLineGeometry.dispose();(aimLine.material as THREE.Material).dispose();aim.geometry.dispose();(aim.material as THREE.Material).dispose();(command.material as THREE.Material).dispose();}};
}
