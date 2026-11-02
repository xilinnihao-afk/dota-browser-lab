import {gamePoint,gameRect} from './viewport';
import {gameViewport} from './viewport';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {disposeAssets,setAssetRoot} from './assets';
import {type MapData,heightAt} from './map-data';
import {createMapTerrain} from './map-terrain';
import {createMapObjects} from './map-objects';
import {createMapLighting} from './map-lighting';
import './map-style.css';
import {mapLoading} from './loading-screen';
const loading=mapLoading();
import {createBattle} from './battle/controller';
import {isBattlePlacement} from './battle/world';
import {mobileEnvironment,loadMobileQuality,renderProfile,type MobileQuality} from './battle/mobile-profile';
const query=new URLSearchParams(location.search);
const playMode=query.has('play')||(!query.has('scene')&&!query.has('view')&&!query.has('capture'));
if(playMode)document.body.classList.add('is-playing');
let battle:Awaited<ReturnType<typeof createBattle>>|undefined;

document.title='IMBA 3.83d AI · 经典地图';
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<canvas id="map-canvas" aria-label="IMBA 3.83d AI 原地图三维预览"></canvas>
<header><div class="map-brand">IMBA <span>3.83d AI</span><small>WARCRAFT III · CLASSIC MAP</small></div>
<nav aria-label="地图视角"><button data-view="sentinel">近卫基地</button><button data-view="river">中路河道</button><button data-view="scourge">天灾基地</button><button data-view="overview">全图</button></nav>
<a href="?play=1">开始试玩 ↗</a><a href="?models=1">模型查看器 ↗</a></header>
<div class="map-location"><span id="location-label">近卫基地</span><small>原地图地形 · 原版模型与贴图</small></div>
<footer><div class="minimap-wrap"><button id="minimap" aria-label="点击小地图移动视角"><img src="${import.meta.env.BASE_URL}assets/imba/minimap.png" alt="W3X 内嵌原始小地图"><i id="map-marker"></i></button><span>源地图小地图</span></div>
<div class="map-info"><strong>IMBA 3.83d AI</strong><p>拖动平移 · 滚轮缩放 · 右键旋转<br>W A S D 移动视角 · 点击小地图定位</p><div class="toggles"><button id="trees" aria-pressed="true">树林</button><button id="water" aria-pressed="true">水面</button><button id="pause" aria-pressed="false">暂停动画</button></div><div class="scene-selects"><label>细节 <select id="detail-view" aria-label="细节观察"><option value="">选择位置</option><option value="fountain">近卫泉水</option><option value="waterfall">瀑布</option><option value="ramp">河道坡道</option></select></label><label>时刻 <select id="day-hour" aria-label="光照时刻"><option value="6">06:00 晨曦</option><option value="12">12:00 日间</option><option value="18">18:00 黄昏</option><option value="0">00:00 夜间</option></select></label></div></div>
<div class="map-meta"><span id="asset-status">读取地图……</span><details><summary>还原进度</summary><p id="known-limits">地图与物件来自 W3X。正在载入……</p></details></div></footer>
`;
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const renderer=new THREE.WebGLRenderer({canvas:$<HTMLCanvasElement>('map-canvas'),antialias:true,powerPreference:'high-performance'});
let quality=loadMobileQuality(),mobileRenderer=mobileEnvironment(),frameLimit=60;
function applyQuality(value:MobileQuality){quality=value;mobileRenderer=mobileEnvironment();const profile=renderProfile(mobileRenderer,quality,devicePixelRatio);frameLimit=profile.fps;renderer.setPixelRatio(profile.pixelRatio);renderer.setSize(gameViewport.width,gameViewport.height);}
applyQuality(quality);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#111711');

const camera=new THREE.PerspectiveCamera(42,1,16,60000);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.14;controls.screenSpacePanning=false;controls.minDistance=500;controls.maxDistance=38000;controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.005;
controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
let view='sentinel',paused=query.has('capture'),disposed=false;
$('pause').textContent=paused?'播放动画':'暂停动画';$('pause').setAttribute('aria-pressed',String(paused));
function resize(){applyQuality(quality);camera.aspect=gameViewport.width/gameViewport.height;camera.updateProjectionMatrix();}resize();addEventListener('resize',resize);
setAssetRoot('assets/imba/resources/');
try {await start();}catch(error){loading.fail(error);console.error(error);}
async function start(){
  loading.set(4,'读取原地图与地形数据');
  const response=await fetch(`${import.meta.env.BASE_URL}assets/imba/map.json`);if(!response.ok)throw new Error('请先运行 npm run map:import -- /path/to/map.w3x');
  const map:MapData=await response.json();
  loading.set(10,'重建地形、悬崖与水面');
  const lighting=await createMapLighting(map);lighting.setHour(Number(query.get('hour')??map.lighting.initialHour));
  const terrain=await createMapTerrain(map);scene.add(terrain.root);loading.set(22,'载入原版模型与贴图');
  const objects=await createMapObjects(map,(done,total)=>{loading.set(22+done/Math.max(1,total)*52,'载入原版模型与贴图');},Math.max(0,Math.min(12,Number(query.get('time')??4))),query.has('diagnostics'),!(query.has('diagnostics')&&query.get('skinning')==='cpu'),playMode?new Set(map.placements.filter(isBattlePlacement)):undefined);scene.add(objects.root);
  lighting.attach(terrain.root,'terrain');lighting.attach(objects.root,'unit');
  $<HTMLSelectElement>('day-hour').value=String(lighting.hour);$('day-hour').onchange=()=>lighting.setHour(Number($<HTMLSelectElement>('day-hour').value));
  const views:Record<string,{label:string;target:[number,number];distance:number}>={sentinel:{label:'近卫基地',target:[-5700,-6150],distance:2600},river:{label:'中路河道',target:[-450,-250],distance:2450},scourge:{label:'天灾基地',target:[5350,4800],distance:2600},overview:{label:'全图',target:[0,-1500],distance:32000},fountain:{label:'近卫泉水',target:[-7220,-7120],distance:1000},waterfall:{label:'西侧瀑布',target:[-7660,-2910],distance:1550},ramp:{label:'河道坡道',target:[-320,-575],distance:1750},battle:{label:'中路试炼',target:[-500,-700],distance:2300}};
  function setView(name:string){view=views[name]?name:'sentinel';const preset=views[view];const z=heightAt(map,...preset.target);
    controls.target.set(...preset.target,z);camera.position.set(preset.target[0],preset.target[1]-preset.distance*(view==='overview'?.01:.68),z+preset.distance*(view==='overview'?1:.9));controls.update();
    $('location-label').textContent=preset.label;document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  }
  setView(query.get('view')??(playMode?'battle':'sentinel'));$('detail-view').onchange=()=>{const name=$<HTMLSelectElement>('detail-view').value;if(name)setView(name);};document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view!));
  $('trees').onclick=()=>{objects.trees.visible=!objects.trees.visible;$('trees').setAttribute('aria-pressed',String(objects.trees.visible));};
  $('water').onclick=()=>{terrain.waterGroup.visible=!terrain.waterGroup.visible;$('water').setAttribute('aria-pressed',String(terrain.waterGroup.visible));};
  const setPaused=(value:boolean)=>{paused=value;if(battle)battle.simulation.paused=value;$('pause').setAttribute('aria-pressed',String(paused));$('pause').textContent=paused?'播放动画':'暂停动画';};$('pause').onclick=()=>setPaused(!paused);
  $('minimap').onclick=event=>{const rect=gameRect($('minimap'));const x=map.offset[0]+(gamePoint(event).x-rect.left)/rect.width*(map.width-1)*128,y=map.offset[1]+(1-(gamePoint(event).y-rect.top)/rect.height)*(map.height-1)*128;
    const z=heightAt(map,x,y);controls.target.set(x,y,z);camera.position.set(x,y-1750,z+2250);controls.update();$('location-label').textContent='自由观察';view='custom';document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  };
  const keys=new Set<string>();const keydown=(e:KeyboardEvent)=>{if(e.target instanceof HTMLButtonElement||e.target instanceof HTMLAnchorElement||e.target instanceof HTMLSelectElement)return;if((playMode?['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']:['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']).includes(e.key)){keys.add(e.key);e.preventDefault();}};
  const keyup=(e:KeyboardEvent)=>keys.delete(e.key),blur=()=>keys.clear();addEventListener('keydown',keydown);addEventListener('keyup',keyup);addEventListener('blur',blur);
  const diagnostic=document.createElement('output');diagnostic.id='map-diagnostics';diagnostic.hidden=true;if(import.meta.env.DEV||query.has('diagnostics'))app.append(diagnostic);
  $('asset-status').textContent=`128 × 128 地图 · ${objects.counts.placedDoodads.toLocaleString()} 个装饰物 · ${objects.counts.placedUnits} 个静态单位`;
  $('known-limits').textContent=`使用这份 W3X 的地形、物件变换和初始化坐标。已接入原坡道转接、粒子、UV 动画与 Felwood 昼夜光照。全图采用合批静态姿态与 10 Hz 特效，近景恢复完整动画；尚未执行对战脚本。${objects.failures.length?`有 ${objects.failures.length} 类资源未载入。`:''}`;
  if(playMode){loading.set(76,'准备英雄、兵线与音效');battle=await createBattle({map,scene,camera,controls,app,canvas:renderer.domElement,ground:[terrain.ground,terrain.cliffGroup],light:root=>lighting.attach(root,'unit'),setPaused,isPaused:()=>paused,diagnostics:import.meta.env.DEV||query.has('diagnostics'),setQuality:applyQuality,onProgress:(fraction,message)=>loading.set(76+fraction*22,message)});}
  loading.set(99,'准备画面');let firstFrame=true;
  let last=performance.now(),sample=0,frames=0,fps=0,uiTime=0,maxDelta=0,far=false;
  const cpuSamples:number[]=[],frameSamples:number[]=[];let timings={battle:0,objects:0,lighting:0,terrain:0,render:0};const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return Math.round((sorted[Math.floor((sorted.length-1)*p)]??0)*100)/100;};
  const frame=(now:number)=>{if(mobileRenderer&&now-last<1000/frameLimit-1)return;const elapsed=(now-last)/1000,delta=Math.min(elapsed,.06);last=now;maxDelta=Math.max(maxDelta,elapsed*1000);
    if(battle?.simulation.phase==='choose')keys.clear();
    const speed=Math.max(900,camera.position.distanceTo(controls.target)*.55)*delta;
    const dx=(Number(keys.has('d')||keys.has('ArrowRight'))-Number(keys.has('a')||keys.has('ArrowLeft')))*speed,dy=(Number(keys.has('w')||keys.has('ArrowUp'))-Number(keys.has('s')||keys.has('ArrowDown')))*speed;
    camera.position.x+=dx;camera.position.y+=dy;controls.target.x+=dx;controls.target.y+=dy;
    if(dx||dy)battle?.releaseFollow();
    controls.update();const cpuStart=performance.now();battle?.update(delta,paused);const objectStart=performance.now(),distance=camera.position.distanceTo(controls.target),nextFar=query.get('tier')==='near'?false:far?distance>9000:distance>11000;
    if(nextFar!==far){far=nextFar;terrain.setFar(far);objects.setFar(far);}
    objects.update(delta,camera,paused);const objectEnd=performance.now();lighting.updateLocal(objects.localLights,controls.target);const lightEnd=performance.now();terrain.update(paused?0:delta);const terrainEnd=performance.now();renderer.render(battle?.selectionScene??scene,camera);if(firstFrame){firstFrame=false;loading.complete();}const renderEnd=performance.now();timings={battle:objectStart-cpuStart,objects:objectEnd-objectStart,lighting:lightEnd-objectEnd,terrain:terrainEnd-lightEnd,render:renderEnd-terrainEnd};
    cpuSamples.push(performance.now()-cpuStart);frameSamples.push(elapsed*1000);if(cpuSamples.length>120){cpuSamples.shift();frameSamples.shift();}
    sample+=elapsed;frames++;uiTime+=delta;if(sample>.7){fps=Math.round(frames/sample);sample=0;frames=0;}
    if(uiTime>.2){uiTime=0;$('map-marker').style.left=`${(controls.target.x-map.offset[0])/((map.width-1)*128)*100}%`;$('map-marker').style.top=`${(1-(controls.target.y-map.offset[1])/((map.height-1)*128))*100}%`;
      if(diagnostic.isConnected)diagnostic.textContent=JSON.stringify({source:map.source,view,paused,lighting:lighting.diagnostics,effects:objects.stats,timings,cpuFrameMs:{p50:percentile(cpuSamples,.5),p95:percentile(cpuSamples,.95)},rafFrameMs:{p50:percentile(frameSamples,.5),p95:percentile(frameSamples,.95)},sourceCounts:map.stats,renderedCounts:objects.counts,failures:objects.failures,terrainChunks:terrain.ground.children.length,cliffChunks:terrain.cliffGroup.children.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,fps,maxFrameMs:Math.round(maxDelta),camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov},viewport:[gameViewport.width,gameViewport.height],quality:{mode:quality,mobile:mobileRenderer,pixelRatio:renderer.getPixelRatio(),frameLimit},trees:objects.trees.visible,water:terrain.waterGroup.visible});maxDelta=0;
    }
  };renderer.setAnimationLoop(frame);
  addEventListener('pagehide',e=>{renderer.setAnimationLoop(null);if(e.persisted)return;disposed=true;battle?.dispose();objects.dispose();terrain.dispose();controls.dispose();renderer.dispose();void disposeAssets();removeEventListener('keydown',keydown);removeEventListener('keyup',keyup);removeEventListener('blur',blur);removeEventListener('resize',resize);});
  addEventListener('pageshow',()=>{if(!disposed){last=performance.now();renderer.setAnimationLoop(frame);}});
}
