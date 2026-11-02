import * as THREE from 'three';
import { createMap, terrainHeight, HALF_MAP } from './game/map';
import { Simulation, FIXED_STEP } from './game/simulation';
import { GameAudio } from './game/audio';
import { createWorld } from './render/world';
import { createUnitVisual } from './render/units';
import { Feedback } from './render/feedback';
import { Hud } from './ui/Hud';
import type { RenderMetrics } from './game/types';
import './ui/style.css';

const app=document.querySelector<HTMLDivElement>('#app')!;
const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','远古渡口战场，右键移动或攻击');canvas.tabIndex=0;app.append(canvas);
let renderer:THREE.WebGLRenderer;
try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}
catch {app.innerHTML='<main style="color:#eee;background:#14201c;padding:4rem;font:18px sans-serif"><h1>无法启动三维战场</h1><p>此原型需要支持 WebGL2 的桌面浏览器。请启用硬件加速后刷新页面。</p></main>';throw new Error('WebGL2 unavailable');}
renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('#263b35');scene.fog=new THREE.Fog('#516258',90,155);
scene.add(new THREE.HemisphereLight('#e1ecdb','#344231',2.0));
const sun=new THREE.DirectionalLight('#ffe6b1',3.0);sun.position.set(-25,48,22);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-54;sun.shadow.camera.right=54;sun.shadow.camera.top=54;sun.shadow.camera.bottom=-54;
sun.shadow.camera.near=1;sun.shadow.camera.far=120;sun.shadow.normalBias=.045;sun.shadow.bias=-.00015;scene.add(sun);scene.add(sun.target);
const map=createMap();const simulation=new Simulation(map);const world=createWorld(scene,map);
const visuals=new Map(simulation.state.units.map(unit=>{const visual=createUnitVisual(unit);scene.add(visual.root);return [unit.id,visual];}));
const feedback=new Feedback(scene,app),audio=new GameAudio();
const camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,230);
const cameraTarget=new THREE.Vector3(0,0,0),desiredTarget=new THREE.Vector3(0,0,0);
let cameraHeight=60,cameraLocked=false,width=innerWidth,height=innerHeight;
const cameraOffset=new THREE.Vector3(25,58,40);
const keys=new Set<string>();const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
let showPaths=false,lastHoverCheck=0,dragStart:{x:number;y:number;target:THREE.Vector3}|null=null;
const metrics:RenderMetrics={fps:0,frameMs:0,calls:0,triangles:0,geometries:0,textures:0};
const pathLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xb7df9c,transparent:true,opacity:.85,depthTest:false}));pathLine.renderOrder=4;scene.add(pathLine);
const debugPositions:number[]=[];
for(const obstacle of map.obstacles)for(let i=0;i<24;i++){for(const angle of [i/24*Math.PI*2,(i+1)/24*Math.PI*2]){const x=obstacle.x+Math.cos(angle)*(obstacle.radius+.7),z=obstacle.z+Math.sin(angle)*(obstacle.radius+.7);debugPositions.push(x,terrainHeight(x,z)+.15,z);}}
const debugGeometry=new THREE.BufferGeometry();debugGeometry.setAttribute('position',new THREE.Float32BufferAttribute(debugPositions,3));
const debugObstacles=new THREE.LineSegments(debugGeometry,new THREE.LineBasicMaterial({color:0xe5ab72,transparent:true,opacity:.5,depthTest:false}));debugObstacles.visible=false;scene.add(debugObstacles);
const uiContainer=document.createElement('div');uiContainer.id='game-ui';app.append(uiContainer);
const reset=()=>{simulation.reset();feedback.reset();accumulator=0;elapsedVisual=0;cameraLocked=false;desiredTarget.set(0,0,0);cameraTarget.copy(desiredTarget);cameraHeight=60;updateProjection();};
const center=()=>{desiredTarget.set(simulation.hero.x,0,simulation.hero.z);cameraLocked=true;simulation.select('hero');};
const togglePaths=()=>{showPaths=!showPaths;debugObstacles.visible=showPaths;};
const attackMode=()=>{if(simulation.state.phase==='playing'&&!simulation.state.paused){simulation.state.attackMode=!simulation.state.attackMode;simulation.state.command=simulation.state.attackMode?'左键敌人指定攻击目标':'右键地面移动 · 右键敌人攻击';}};
const hud=new Hud(uiContainer,{onAttackMode:attackMode,onStop:()=>simulation.stop(),onCenter:center,onReset:reset,onPause:()=>simulation.togglePause(),onMute:()=>{audio.unlock();audio.toggle();},onTogglePaths:togglePaths,onMinimap:(x,z)=>{desiredTarget.set(x,0,z);cameraLocked=false;}},map);
hud.update({state:simulation.state,hero:simulation.hero,selected:simulation.hero,metrics,muted:audio.muted,showPaths,cameraLocked});

function updateProjection(){const aspect=width/height;camera.left=-cameraHeight*aspect/2;camera.right=cameraHeight*aspect/2;camera.top=cameraHeight/2;camera.bottom=-cameraHeight/2;camera.updateProjectionMatrix();}
function resize(){width=innerWidth;height=innerHeight;renderer.setSize(width,height);updateProjection();}
resize();window.addEventListener('resize',resize);
function ray(event:PointerEvent|MouseEvent){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitUnit(){
  const hits=raycaster.intersectObjects([...visuals.values()].map(v=>v.root),true);
  for(const hit of hits){let obj:THREE.Object3D|null=hit.object;while(obj&&!obj.userData.unitId)obj=obj.parent;const id=obj?.userData.unitId as string|undefined;if(id&&(simulation.getUnit(id)?.hp??0)>0)return id;}
  return null;
}
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
  audio.unlock();canvas.focus({preventScroll:true});
  if(event.button===1){event.preventDefault();dragStart={x:event.clientX,y:event.clientY,target:desiredTarget.clone()};canvas.setPointerCapture(event.pointerId);return;}
  if(event.button!==0&&event.button!==2)return;
  ray(event);const unitId=hitUnit();
  if(event.button===0&&!simulation.state.attackMode){if(unitId)simulation.select(unitId);return;}
  if(unitId&&simulation.getUnit(unitId)?.team==='enemy'){simulation.attack(unitId);return;}
  const hit=raycaster.intersectObject(world.ground,false)[0];if(hit)simulation.move({x:hit.point.x,z:hit.point.z});
});
canvas.addEventListener('pointermove',event=>{
  if(dragStart){cameraLocked=false;const scale=cameraHeight/height,dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;desiredTarget.set(dragStart.target.x-dx*scale*.85-dy*scale*.55,0,dragStart.target.z+dx*scale*.53-dy*scale*.85);return;}
  if(performance.now()-lastHoverCheck<70)return;lastHoverCheck=performance.now();ray(event);simulation.state.hoveredId=hitUnit();
});
canvas.addEventListener('pointerup',()=>{dragStart=null;});canvas.addEventListener('pointercancel',()=>{dragStart=null;});canvas.addEventListener('pointerleave',()=>{simulation.state.hoveredId=null;});
canvas.addEventListener('wheel',event=>{event.preventDefault();cameraHeight=THREE.MathUtils.clamp(cameraHeight+event.deltaY*.035,30,86);updateProjection();},{passive:false});
window.addEventListener('keydown',event=>{
  if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
  if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyS','Escape','KeyP'].includes(event.code))event.preventDefault();
  keys.add(event.code);if(event.repeat)return;
  audio.unlock();
  if(event.code==='KeyA')attackMode();
  if(event.code==='KeyS')simulation.stop();
  if(event.code==='Space')center();
  if(event.code==='Escape'){if(simulation.state.attackMode)simulation.state.attackMode=false;else simulation.togglePause();}
  if(event.code==='KeyP')togglePaths();
  if(event.code==='KeyM')audio.toggle();
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{keys.clear();dragStart=null;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&simulation.state.phase==='playing'){simulation.state.paused=true;keys.clear();accumulator=0;}});

let previous=performance.now(),accumulator=0,frameSample=0,frameCount=0,uiClock=0,elapsedVisual=0;
function frame(now:number){
  const delta=Math.min((now-previous)/1000,.1);previous=now;
  if(!simulation.state.paused&&simulation.state.phase==='playing'){accumulator+=delta;while(accumulator>=FIXED_STEP){simulation.step();accumulator-=FIXED_STEP;}elapsedVisual+=delta;}else accumulator=0;
  const dx=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),dy=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
  if(dx||dy){cameraLocked=false;const speed=22*delta;desiredTarget.x+=(dx*.85+dy*.53)*speed;desiredTarget.z+=(-dx*.53+dy*.85)*speed;}
  if(cameraLocked){desiredTarget.x=simulation.hero.x;desiredTarget.z=simulation.hero.z;}
  desiredTarget.x=THREE.MathUtils.clamp(desiredTarget.x,-HALF_MAP+9,HALF_MAP-9);desiredTarget.z=THREE.MathUtils.clamp(desiredTarget.z,-HALF_MAP+9,HALF_MAP-9);
  cameraTarget.lerp(desiredTarget,1-Math.exp(-delta*8));camera.position.copy(cameraTarget).add(cameraOffset);camera.lookAt(cameraTarget.x,1,cameraTarget.z);
  const simDelta=simulation.state.paused?0:delta;
  for(const unit of simulation.state.units){const visual=visuals.get(unit.id)!;visual.root.position.set(unit.x,terrainHeight(unit.x,unit.z),unit.z);visual.root.rotation.y=unit.facing;visual.update(unit,simDelta,simulation.state.time);}
  world.update(elapsedVisual);
  pathLine.visible=showPaths&&simulation.hero.path.length>0;
  if(pathLine.visible){const points=[simulation.hero,...simulation.hero.path].map(p=>new THREE.Vector3(p.x,terrainHeight(p.x,p.z)+.13,p.z));pathLine.geometry.dispose();pathLine.geometry=new THREE.BufferGeometry().setFromPoints(points);}
  feedback.update(simulation.state,camera,simDelta,width,height,event=>audio.event(event));
  canvas.style.cursor=simulation.state.attackMode?'crosshair':simulation.state.hoveredId?'pointer':'default';
  renderer.render(scene,camera);
  frameSample+=delta;frameCount++;uiClock+=delta;
  if(frameSample>=.65){metrics.fps=Math.round(frameCount/frameSample);metrics.frameMs=frameSample/frameCount*1000;metrics.calls=renderer.info.render.calls;metrics.triangles=renderer.info.render.triangles;metrics.geometries=renderer.info.memory.geometries;metrics.textures=renderer.info.memory.textures;frameSample=0;frameCount=0;}
  if(uiClock>=.08){hud.update({state:simulation.state,hero:simulation.hero,selected:simulation.getUnit(simulation.state.selectedId)??simulation.hero,metrics,muted:audio.muted,showPaths,cameraLocked});uiClock=0;}
}
renderer.setAnimationLoop(frame);

// Read-only diagnostics are deliberately gated. No gameplay cheats are in the ordinary UI.
if(import.meta.env.DEV||new URLSearchParams(location.search).has('diagnostics')){
  const diagnostic=document.createElement('output');diagnostic.id='game-diagnostics';diagnostic.hidden=true;app.append(diagnostic);
  const updateDiagnostic=()=>{
    const projected=simulation.state.units.map(u=>{const p=new THREE.Vector3(u.x,terrainHeight(u.x,u.z)+1.6,u.z).project(camera);return {id:u.id,x:u.x,z:u.z,hp:u.hp,status:u.status,screenX:(p.x*.5+.5)*width,screenY:(-.5*p.y+.5)*height};});
    diagnostic.textContent=JSON.stringify({phase:simulation.state.phase,paused:simulation.state.paused,time:simulation.state.time,hero:simulation.hero,units:projected,metrics,camera:{x:cameraTarget.x,z:cameraTarget.z,span:cameraHeight},seed:map.seed,source:'procedural-stand-ins'});
  };
  const diagnosticTimer=setInterval(updateDiagnostic,250);updateDiagnostic();
  window.addEventListener('pagehide',event=>{if(!event.persisted)clearInterval(diagnosticTimer);});
}
window.addEventListener('pagehide',event=>{
  renderer.setAnimationLoop(null);
  if(event.persisted)return;
  hud.dispose();feedback.dispose();audio.dispose();world.dispose();visuals.forEach(v=>v.dispose());renderer.dispose();
});
window.addEventListener('pageshow',event=>{if(event.persisted){previous=performance.now();accumulator=0;renderer.setAnimationLoop(frame);}});
