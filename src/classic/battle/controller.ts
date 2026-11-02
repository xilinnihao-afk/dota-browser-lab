import {gamePoint,gameRect} from '../viewport';
import {gameViewport} from '../viewport';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {MapData} from '../map-data';
import {heightAt} from '../map-data';
import {MapNavigation,distance,type Point} from './navigation';
import {BattleSimulation,STEP} from './simulation';
import {HEROES,SKILL_KEYS,type HeroId,type SkillSlot} from './definitions';
import {createBattleView} from './view';
import {createBattleHud} from './hud';
import {createBattleAudio} from './audio';
import {createSelectionScene} from './selection-scene';
import {CAMPS,mapShops} from './world';
import {isStructure} from './structures';
import {createMobileControls} from './mobile-controls';
import {DIRECTIONAL_SKILLS,screenToWorld,touchAimPoint,touchTarget} from './mobile-input';
import type {MobileQuality} from './mobile-profile';
import './style.css';
import './classic-hud.css';
interface Options {map:MapData;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;app:HTMLElement;canvas:HTMLCanvasElement;ground:THREE.Object3D[];light(root:THREE.Object3D):void;setPaused(value:boolean):void;isPaused():boolean;diagnostics:boolean;setQuality?:(value:MobileQuality)=>void;onProgress?:(fraction:number,message:string)=>void}
export async function createBattle(options:Options){
  const {map,scene,camera,controls,app,canvas}=options;
  const response=await fetch(`${import.meta.env.BASE_URL}assets/imba/pathing.wpm`);if(!response.ok)throw new Error('试玩寻路尚未准备：请运行 npm run play:prepare -- /path/to/map.w3x');
  const nav=new MapNavigation(map,await response.arrayBuffer()),sim=new BattleSimulation(nav,CAMPS),shops=mapShops(map);
  options.onProgress?.(.1,'准备英雄语音与音效');
  const audio=await createBattleAudio();audio.bindGestures(app);options.onProgress?.(.25,'准备英雄、兵线与技能');
  let armed:SkillSlot|null=null,follow=true,accumulator=0,uiClock=0,hover:Point|null=null,lastHero:HeroId='juggernaut',disposed=false;
  let command:'move'|'attack'|null=null;
  const movementKeys=new Set<string>();
  let touchMovement:Point|null=null,mobile:ReturnType<typeof createMobileControls>|undefined;
  const clearMovement=()=>{movementKeys.clear();touchMovement=null;sim.steer(null);mobile?.resetMove();};
  const stop=()=>{clearMovement();armed=null;command=null;view.setAim(null);sim.stop();};
  const pause=()=>{clearMovement();mobile?.reset();sim.paused=!options.isPaused();audio.setPaused(sim.paused);options.setPaused(sim.paused);};
  const attack=(id:string)=>{clearMovement();if(sim.attack(id))audio.voice(sim.hero.heroId!,'attack');};
  const select=(id:string)=>{if(armed){const skill=HEROES[sim.hero.heroId!].skills[armed];const target=sim.unit(id);if(skill.target==='enemy'&&sim.cast(armed,id)){armed=null;view.setAim(null);}else if(skill.target==='point'&&target&&sim.cast(armed,target)){armed=null;view.setAim(null);}return;}const target=sim.unit(id);if(command==='move'&&target){if(sim.move(target))command=null;return;}if(command==='attack'&&target?.team===0){sim.message='请选择敌军或野怪';return;}command=null;sim.selectedId=id;if(target?.team!==0&&target)attack(id);else if(id==='hero'&&sim.hero)audio.voice(sim.hero.heroId!,'select');};
  const view=await createBattleView(map,scene,app,options.light,select,shops,()=>hud.toggleShop(true));
  options.onProgress?.(.65,'准备能量圈与英雄祭坛');
  const selection=await createSelectionScene(map,options.light,fraction=>options.onProgress?.(.65+fraction*.3,'准备能量圈与英雄祭坛'));
  function center(){const h=sim.hero;if(!h)return;follow=true;const z=heightAt(map,h.x,h.y);controls.target.set(h.x,h.y+180,z+40);camera.position.set(h.x,h.y-1600,z+2150);controls.update();}
  function start(id:HeroId){if(!HEROES[id])return;mobile?.reset();hud.closePanels();selection.setActive(false);controls.enabled=true;camera.clearViewOffset();view.setVisible(true);clearMovement();command=null;audio.clear();audio.setPaused(false);audio.voice(id,'select');view.clear();sim.start(id);if(mobile?.active)sim.message='摇杆移动 · 点普攻攻击附近目标 · 技能拖动瞄准、松手释放';lastHero=id;armed=null;accumulator=0;options.setPaused(false);center();hud.update(sim,armed,false);canvas.focus({preventScroll:true});}
  function skill(slot:SkillSlot){audio.unlock();if(!sim.canCommand())return;command=null;const def=HEROES[sim.hero.heroId!].skills[slot];if(def.target==='self'){sim.cast(slot);armed=null;view.setAim(null);}else{const error=sim.skillError(slot);if(error&&!/请选择/.test(error)){sim.message=error;return;}armed=armed===slot?null:slot;view.setAim(null);}hud.update(sim,armed,options.isPaused());}
  function armCommand(value:'move'|'attack'){if(!sim.canCommand())return;clearMovement();armed=null;view.setAim(null);command=value;sim.message=value==='move'?'移动：左键选择地面 · Esc 取消':'攻击：左键选择敌军或野怪 · Esc 取消';}
  const hud=createBattleHud(app,view.icons,{preview:id=>selection.select(id),start,skill,attack:()=>armCommand('attack'),moveMode:()=>armCommand('move'),look:point=>{follow=false;const z=heightAt(map,point.x,point.y),delta=new THREE.Vector3(point.x-controls.target.x,point.y-controls.target.y,z+40-controls.target.z);camera.position.add(delta);controls.target.add(delta);controls.update();},stop,center,pause,restart:()=>start(lastHero),choose:()=>{mobile?.reset();selection.setActive(true);controls.enabled=false;options.setPaused(false);camera.clearViewOffset();clearMovement();command=null;audio.clear();sim.phase='choose';sim.extraAbilities.clear();sim.units=[];sim.projectiles=[];sim.events=[];view.clear();armed=null;accumulator=0;view.setVisible(false);hud.showPicker();},recover:()=>{clearMovement();sim.recover();follow=true;},buy:id=>{audio.unlock();sim.buy(id);},use:id=>{audio.unlock();sim.useItem(id);},sell:id=>sim.sell(id),equip:id=>sim.equipOrb(id),camp:id=>{clearMovement();if(sim.goToCamp(id)){follow=true;audio.voice(sim.hero.heroId!,'move');}},mute:()=>audio.toggle(),isMuted:()=>audio.muted,audioLabel:()=>audio.buttonLabel,shop:()=>{clearMovement();mobile?.reset();armed=null;command=null;view.setAim(null);}},map);
  controls.enabled=false;view.setVisible(false);hud.update(sim,null,false);
  controls.enableRotate=false;controls.mouseButtons.LEFT=THREE.MOUSE.PAN;delete controls.mouseButtons.RIGHT;controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;controls.minDistance=1000;controls.maxDistance=9000;
  controls.touches.ONE=THREE.TOUCH.PAN;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
  const cameraRight=()=>({x:camera.matrixWorld.elements[0],y:camera.matrixWorld.elements[1]});
  const nearby=(range:number,skill=false,direction?:Point|null)=>touchTarget(sim.hero,sim.units,{range,now:sim.time,selected:sim.selectedId,skill,direction,visible:u=>sim.canSee(sim.hero,u)});
  function touchSkill(slot:SkillSlot,drag:Point|null,release:boolean){
    if(!sim.canCommand())return;const h=sim.hero,s=HEROES[h.heroId!].skills[slot];let target:Point|string|undefined;
    if(s.target==='enemy'){target=nearby(s.range,true,drag?screenToWorld(drag,cameraRight()):null)?.id;}
    else if(s.target==='point'){
      if(drag)target=touchAimPoint(h,drag,s.range,cameraRight(),DIRECTIONAL_SKILLS.has(s.id));
      else {const enemy=nearby(s.range,true);target=enemy?{x:enemy.x,y:enemy.y}:{x:h.x+Math.cos(h.facing)*Math.min(s.range-.5,600),y:h.y+Math.sin(h.facing)*Math.min(s.range-.5,600)};const d=distance(h,target);if(d>=s.range){const ratio=(s.range-.5)/d;target={x:h.x+(target.x-h.x)*ratio,y:h.y+(target.y-h.y)*ratio};}}
    }
    if(release){armed=null;command=null;audio.unlock();sim.cast(slot,target);view.setAim(null);}
    else {const point=s.target==='self'?h:typeof target==='string'?sim.unit(target):target;view.setAim(point??null,s.target==='enemy'?110:Math.max(65,s.radius),!sim.skillError(slot,target),h);}
  }
  mobile=createMobileControls(hud.element,view.icons,{
    move:value=>{if(value&&!sim.canCommand())return;touchMovement=value;movementKeys.clear();if(value){audio.unlock();follow=true;command=null;armed=null;}else sim.steer(null);},
    attack:()=>{clearMovement();armed=null;command=null;const target=nearby(900);if(target)attack(target.id);else sim.message='附近没有可攻击目标';},stop,
    aim:touchSkill,cancelAim:()=>view.setAim(null),shop:()=>hud.toggleShop(),inventory:()=>hud.toggleInventory(),camps:()=>hud.toggleCamps(),center,recover:()=>{clearMovement();sim.recover();follow=true;},preview:id=>hud.previewHero(id),quality:value=>options.setQuality?.(value)
  });
  canvas.tabIndex=0;canvas.setAttribute('aria-label','中路战场，WASD 移动，左键拖动地图或点击敌军攻击，Q E R 释放技能，B 商店，N 野区');
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),sphere=new THREE.Sphere(),hit=new THREE.Vector3();
  const setRay=(event:PointerEvent|MouseEvent)=>{const r=gameRect(canvas);pointer.set((gamePoint(event).x-r.left)/r.width*2-1,1-(gamePoint(event).y-r.top)/r.height*2);ray.setFromCamera(pointer,camera);};
  const hitUnit=()=>{let closest:string|null=null,d=Infinity;for(const u of sim.units){if(u.hp<=0)continue;sphere.center.set(u.x,u.y,heightAt(map,u.x,u.y)+(u.kind==='base'?200:u.kind==='tower'?140:90));sphere.radius=u.kind==='base'?260:u.kind==='tower'?160:u.kind==='hero'?90:70*u.scale;if(ray.ray.intersectSphere(sphere,hit)){
    // Overlapping generous pick volumes must not let our hero steal a click
    // aimed at a nearby enemy's body. Prefer the body nearest the pointer.
    const value=ray.ray.distanceToPoint(sphere.center)/sphere.radius;if(value<d){d=value;closest=u.id;}
  }}return closest;};
  const hitGround=()=>{const results=ray.intersectObjects(options.ground,true);return results.length?{x:results[0].point.x,y:results[0].point.y}:null;};
  const canvasPointers=new Set<number>();let multiGesture=false;
  let pointerStart={x:0,y:0},pointerDragged=false;const pointerdown=(e:PointerEvent)=>{audio.unlock();if(!canvasPointers.size){multiGesture=false;pointerStart={x:gamePoint(e).x,y:gamePoint(e).y};pointerDragged=false;}canvasPointers.add(e.pointerId);if(canvasPointers.size>1)multiGesture=true;canvas.focus({preventScroll:true});};
  const pointercancel=(e:PointerEvent)=>{canvasPointers.delete(e.pointerId);pointerDragged=true;};
  const resetPointers=()=>{for(const pointerId of [...canvasPointers])canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId}));canvasPointers.clear();multiGesture=false;pointerDragged=true;clearMovement();};
  const pointerup=(e:PointerEvent)=>{canvasPointers.delete(e.pointerId);if(multiGesture)return;if(sim.phase==='choose'){if(e.button===0&&!pointerDragged){setRay(e);const id=selection.pick(ray.ray);if(id)hud.previewHero(id);}return;}if(!sim.canCommand()||(mobile?.active&&hud.hasOpenPanel)||pointerDragged||Math.hypot(gamePoint(e).x-pointerStart.x,gamePoint(e).y-pointerStart.y)>6||![0,2].includes(e.button))return;setRay(e);const id=hitUnit();
    if(e.button===2){clearMovement();armed=null;command=null;view.setAim(null);if(id&&sim.unit(id)?.team!==0)attack(id);else{const p=hitGround();if(p&&sim.move(p))audio.voice(sim.hero.heroId!,'move');}return;}
    if(command==='move'){const p=hitGround();if(p&&sim.move(p)){command=null;audio.voice(sim.hero.heroId!,'move');}return;}if(command==='attack'){if(id)select(id);else sim.message='请选择敌军或野怪';return;}
    if(armed){const s=HEROES[sim.hero.heroId!].skills[armed],p=hitGround();if(sim.cast(armed,s.target==='enemy'?id??undefined:p??undefined)){armed=null;view.setAim(null);}}else if(id)select(id);else {let shopHit=false;for(const shop of shops){sphere.center.set(shop.x,shop.y,heightAt(map,shop.x,shop.y)+110);sphere.radius=140;if(ray.ray.intersectSphere(sphere,hit)){hud.toggleShop(true);shopHit=true;break;}}if(!shopHit){sim.selectedId='hero';if(mobile?.active){const p=hitGround();if(p){clearMovement();if(sim.move(p))audio.voice(sim.hero.heroId!,'move');}}}}
  };
  let hoverAt=0;const pointermove=(e:PointerEvent)=>{
    if((e.buttons&5)&&Math.hypot(gamePoint(e).x-pointerStart.x,gamePoint(e).y-pointerStart.y)>6){pointerDragged=true;follow=false;}
    if(!armed||performance.now()-hoverAt<45||!sim.hero)return;hoverAt=performance.now();setRay(e);hover=hitGround();const s=HEROES[sim.hero.heroId!].skills[armed];view.setAim(hover,s.radius||90,!!hover&&distance(hover,sim.hero)<=s.range);
  };
  const eventKey=(e:KeyboardEvent)=>e.code.startsWith('Key')?e.code.slice(3).toLowerCase():e.key.toLowerCase();
  const context=(e:Event)=>e.preventDefault();const keydown=(e:KeyboardEvent)=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement||(e.target instanceof HTMLElement&&e.target.isContentEditable)||e.altKey||e.ctrlKey||e.metaKey)return;
    const key=eventKey(e);if(['w','a','s','d','q','e','r','x',' ','escape','p','b','n','m','t'].includes(key))e.preventDefault();
    if(sim.phase==='choose'||e.repeat)return;audio.unlock();
    if(['w','a','s','d'].includes(key)){if(sim.canCommand()){if(!movementKeys.size)audio.voice(sim.hero.heroId!,'move');command=null;movementKeys.add(key);}return;}
    const slot=(Object.keys(SKILL_KEYS)as SkillSlot[]).find(s=>SKILL_KEYS[s].toLowerCase()===key);
    if(slot)skill(slot);else if(key==='m')armCommand('move');else if(key==='t')armCommand('attack');else if(key==='x')stop();else if(key===' '){center();sim.selectedId='hero';}else if(key==='b')hud.toggleShop();else if(key==='n')hud.toggleCamps();else if(key==='escape'){hud.closePanels();armed=null;command=null;view.setAim(null);sim.message='已取消施法选点';}else if(key==='p')pause();
  };
  const keyup=(e:KeyboardEvent)=>{movementKeys.delete(eventKey(e));if(!movementKeys.size)sim.steer(null);};
  const manualPan=()=>{follow=false;};const attackEvent=(event:Event)=>{clearMovement();const e=event as CustomEvent<string>;attack(e.detail);};
  const visibility=()=>{if(document.hidden){audio.setPaused(true);clearMovement();if(sim.phase==='playing'){options.setPaused(true);accumulator=0;}}};
  canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointercancel',pointercancel);canvas.addEventListener('pointermove',pointermove);canvas.addEventListener('contextmenu',context);canvas.addEventListener('wheel',manualPan,{passive:true});addEventListener('resize',resetPointers);addEventListener('keydown',keydown);addEventListener('keyup',keyup);addEventListener('blur',clearMovement);app.addEventListener('battle-attack',attackEvent);document.addEventListener('visibilitychange',visibility);
  const diagnostic=document.createElement('output');diagnostic.hidden=true;diagnostic.id='battle-diagnostics';if(options.diagnostics)app.append(diagnostic);
  const project=(p:Point,z=100)=>{const v=new THREE.Vector3(p.x,p.y,heightAt(map,p.x,p.y)+z).project(camera);return{screenX:(v.x*.5+.5)*gameViewport.width,screenY:(-.5*v.y+.5)*gameViewport.height};};
  return{simulation:sim,get selectionScene(){return sim.phase==='choose'?selection.scene:undefined;},releaseFollow(){follow=false;},update(delta:number,paused:boolean){
    if(disposed)return;sim.paused=paused;audio.setPaused(paused||document.hidden);
    if(sim.phase==='choose'){clearMovement();controls.target.set(0,100,0);selection.update(delta,camera,hud.selectionButtons,mobile?.active?80:120,mobile?.active?gameViewport.height-152:(gameRect(hud.element.querySelector('.classic-hud')!).top)-65);uiClock+=delta;if(uiClock>.08){uiClock=0;hud.update(sim,null,false);mobile?.update(sim,false);if(diagnostic.isConnected)diagnostic.textContent=JSON.stringify({phase:'choose',chosen:selection.chosen,selectionHeroes:12,availableHeroes:Object.keys(HEROES).length,paused:false,time:sim.time,audio:audio.diagnostics});}return;}
    if(!sim.canCommand())clearMovement();
    else if(touchMovement){sim.steer(screenToWorld(touchMovement,cameraRight()));sim.message='摇杆移动中';}
    else if(movementKeys.size){
      const x=Number(movementKeys.has('d'))-Number(movementKeys.has('a')),y=Number(movementKeys.has('w'))-Number(movementKeys.has('s'));
      const matrix=camera.matrixWorld.elements,length=Math.hypot(matrix[0],matrix[1])||1,rx=matrix[0]/length,ry=matrix[1]/length;
      sim.steer({x:rx*x-ry*y,y:ry*x+rx*y});
    }
    accumulator=paused||sim.phase!=='playing'?0:Math.min(accumulator+delta,.12);while(accumulator>=STEP){sim.step();accumulator-=STEP;}
    if(follow&&sim.hero&&!paused){const h=sim.hero,z=heightAt(map,h.x,h.y),amount=1-Math.exp(-delta*9),dx=(h.x-controls.target.x)*amount,dy=(h.y+180-controls.target.y)*amount,dz=(z+40-controls.target.z)*amount;camera.position.add(new THREE.Vector3(dx,dy,dz));controls.target.add(new THREE.Vector3(dx,dy,dz));}
    for(const event of sim.drainEvents()){if(event.kind==='respawn'&&event.target==='hero'){clearMovement();armed=null;command=null;center();}view.event(event);if(sim.hero)audio.event(event,sim.hero);}view.update(sim,camera,delta,paused);canvas.style.cursor=armed||command?'crosshair':'default';
    uiClock+=delta;if(uiClock>.08){uiClock=0;mobile?.update(sim,hud.hasOpenPanel);hud.update(sim,armed,paused,{center:controls.target,width:camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*2*camera.aspect,height:camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*2});if(diagnostic.isConnected)diagnostic.textContent=JSON.stringify({phase:sim.phase,paused,time:sim.time,hero:sim.hero,gold:sim.gold,goldEarned:sim.goldEarned,passiveGoldEarned:sim.passiveGoldEarned,itemCharges:sim.itemCharges,itemRecoveryRemaining:sim.itemRecoveryRemaining(),inventory:sim.inventory,activeOrb:sim.activeOrb,neutralKills:sim.neutralKills,inFountain:sim.hero?sim.inFountain(sim.hero):false,fountains:[sim.fountain(0),sim.fountain(1)],structures:sim.units.filter(isStructure).map(u=>({id:u.id,sourceId:u.sourceId,kind:u.kind,team:u.team,hp:u.hp,maxHp:u.maxHp})),camps:sim.camps.map(c=>({id:c.definition.id,name:c.definition.name,x:c.definition.x,y:c.definition.y,alive:c.unitIds.filter(id=>(sim.unit(id)?.hp??0)>0).length,respawnAt:c.respawnAt})),audio:audio.diagnostics,visuals:view.diagnostics,missiles:sim.projectiles.map(p=>({id:p.id,source:p.source,target:p.target,style:p.style})),rivalPerception:sim.rivalPerception,rival:{unit:sim.unit('rival'),mode:sim.rivalMode,gold:sim.rivalGold,earned:sim.rivalGoldEarned,inventory:sim.rivalInventory,itemCharges:sim.rivalItemCharges,itemRecoveryRemaining:sim.itemRecoveryRemaining(sim.unit('rival')),activeOrb:sim.rivalActiveOrb},input:{keys:[...movementKeys],follow,touch:touchMovement,mobile:mobile?.active},selected:sim.selectedId,armed,command,kills:sim.kills,deaths:sim.deaths,wave:sim.wave,unitCount:sim.units.length,projectiles:sim.projectiles.length,units:sim.units.map(u=>({id:u.id,name:u.name,team:u.team,kind:u.kind,hp:u.hp,maxHp:u.maxHp,x:u.x,y:u.y,action:u.action,order:u.order,targetId:u.targetId,attackAt:u.attackAt,pendingHit:u.pendingHit,rootUntil:u.rootUntil,slowUntil:u.slowUntil,stunUntil:u.stunUntil,campId:u.campId,returning:u.returning,...project(u)})),probes:[{x:-1000,y:-900},{x:-600,y:-650},{x:0,y:-350}].map(p=>({...p,...project(p,0),walkable:nav.isFree(p)})),message:sim.message});}
  },dispose(){disposed=true;mobile?.dispose();clearMovement();audio.dispose();selection.dispose();camera.clearViewOffset();view.dispose();hud.dispose();diagnostic.remove();canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointercancel',pointercancel);canvas.removeEventListener('pointermove',pointermove);canvas.removeEventListener('contextmenu',context);canvas.removeEventListener('wheel',manualPan);removeEventListener('resize',resetPointers);removeEventListener('keydown',keydown);removeEventListener('keyup',keyup);removeEventListener('blur',clearMovement);app.removeEventListener('battle-attack',attackEvent);document.removeEventListener('visibilitychange',visibility);}};
}
