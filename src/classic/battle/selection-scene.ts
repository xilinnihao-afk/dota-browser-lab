import {gameViewport} from '../viewport';
import * as THREE from 'three';
import {loadModel,loadTexture,modelTextures} from '../assets';
import {NativeModel} from '../native-model';
import {atlasCell,type MapData} from '../map-data';
import {assets,type HeroId} from './definitions';
import {SELECTION_HEROES,playableSelection} from './selection-roster';

/** Preview-only actors never enter BattleSimulation or the playable map. */
export async function createSelectionScene(map:MapData,light:(root:THREE.Object3D)=>void,onProgress:(fraction:number)=>void){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#111713');
  const root=new THREE.Group();scene.add(root);
  const natives:NativeModel[]=[],owned:THREE.Mesh[]=[];
  const prepared=new Map<string,{source:Awaited<ReturnType<typeof loadModel>>;textures:THREE.Texture[]}>();
  const paths=[...new Set([...SELECTION_HEROES.map(h=>h.model),assets.selectionModels.circle,assets.selectionModels.wisp])];
  let completed=0;
  await Promise.all(paths.map(async path=>{const source=await loadModel(path);prepared.set(path,{source,textures:await modelTextures(source,path===assets.selectionModels.circle||path===assets.selectionModels.wisp?1:0)});onProgress(++completed/paths.length);}));
  function native(path:string){const data=prepared.get(path)!;const actor=NativeModel.fromParsed(data.source,data.textures);actor.enableGpuSkinning();actor.setSequence('Stand');root.add(actor.root);light(actor.root);natives.push(actor);return actor;}
  const tile=map.tiles.find(t=>t.id==='Zbks')??map.tiles[0],texture=await loadTexture(tile.path);
  const vertices:number[]=[],uvs:number[]=[],colors:number[]=[];
  // Use the original Warcraft terrain atlas, including its full-tile variants.
  for(let y=-28;y<28;y++)for(let x=-32;x<32;x++){
    const [col,row]=atlasCell(Math.abs(x*7+y*11)%16,tile.width>tile.height),columns=tile.width/tile.height*4;
    const shade=.7+((x*x+y*y)%5)*.015;
    for(const [dx,dy]of [[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]]){vertices.push((x+dx)*128,(y+dy)*128,-3);uvs.push((col+dx)/columns,(row+1-dy)/4);colors.push(shade*.85,shade,shade*.93);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
  const floor=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:texture,vertexColors:true}));root.add(floor);light(floor);owned.push(floor);
  const circleTexture=await loadTexture('replaceabletextures/selection/selectioncirclelarge.blp');
  const actors=SELECTION_HEROES.map(def=>{
    const actor=native(def.model);actor.root.position.set(def.x,def.y,0);actor.root.rotation.z=-Math.PI/2;actor.root.scale.setScalar(def.scale);
    const ring=new THREE.Mesh(new THREE.PlaneGeometry(285,285),new THREE.MeshBasicMaterial({map:circleTexture,color:0x79dd61,transparent:true,opacity:.85,depthWrite:false}));ring.position.set(def.x,def.y,1);root.add(ring);owned.push(ring);
    return{def,actor,ring};
  });
  const altar=native(assets.selectionModels.circle);altar.root.scale.setScalar(2.3);altar.root.position.set(0,100,0);
  const wisp=native(assets.selectionModels.wisp);wisp.root.scale.setScalar(1.1);wisp.root.position.set(0,100,100);
  const marker=native(assets.selectionModels.circle);marker.root.scale.setScalar(1.15);marker.root.position.set(-630,-490,2);
  // Reuse a real source-map tree along the perimeter, with its replaceable texture.
  const tree=map.placements.find(p=>/tree\d?\.mdx$/i.test(p.model)&&p.replacements);
  if(tree){const source=await loadModel(tree.model),textures=await modelTextures(source,tree.team,tree.replacements);for(let i=0;i<22;i++){const a=Math.PI*i/21,actor=NativeModel.fromParsed(source,textures);actor.enableGpuSkinning();actor.setSequence('Stand');actor.root.position.set(Math.cos(a)*1750,Math.sin(a)*1300+600,-12);actor.root.scale.setScalar(1.4+(i%3)*.2);actor.root.rotation.z=i*2.3;root.add(actor.root);light(actor.root);natives.push(actor);}}
  let chosen:HeroId='juggernaut',width=0,height=0,active=true,clock=0;const projected=new THREE.Vector3(),head=new THREE.Vector3();
  const target=()=>SELECTION_HEROES.find(h=>h.id===chosen)!;
  function select(id:string){const playable=playableSelection(id);if(!playable)return false;chosen=playable;return true;}
  function frame(camera:THREE.PerspectiveCamera,top:number,bottom:number){
    const available=Math.max(230,bottom-top),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const distance=Math.max(3100,3100/(2*tan*camera.aspect*.9),1500/(2*tan*(available/gameViewport.height)));
    camera.clearViewOffset();camera.position.set(0,100-distance*.6,distance*.8);camera.lookAt(0,100,0);
    camera.setViewOffset(gameViewport.width,gameViewport.height,0,gameViewport.height/2-(top+bottom)/2,gameViewport.width,gameViewport.height);camera.updateMatrixWorld();
  }
  return{scene,select,get chosen(){return chosen;},get active(){return active;},setActive(value:boolean){active=value;width=0;height=0;},
    update(dt:number,camera:THREE.PerspectiveCamera,buttons:Map<string,HTMLButtonElement>,top:number,bottom:number){
      if(!active)return;if(width!==gameViewport.width||height!==gameViewport.height){width=gameViewport.width;height=gameViewport.height;frame(camera,top,bottom);}clock+=dt;
      const def=target(),blend=1-Math.exp(-dt*7);wisp.root.position.lerp(new THREE.Vector3(def.x,def.y,125+Math.sin(clock*2)*15),blend);marker.root.position.lerp(new THREE.Vector3(def.x,def.y,2),blend);
      for(const actor of natives)actor.update(dt,camera);
      for(const {def,ring,actor}of actors){ring.material.color.setHex(def.id===chosen?0xffe285:0x79dd61);const button=buttons.get(def.id);if(!button)continue;projected.set(def.x,def.y,0).project(camera);head.set(def.x,def.y,Math.min(280,Math.max(90,actor.source.Info.MaximumExtent[2]))*def.scale).project(camera);button.style.height=`${Math.max(50,(head.y-projected.y)*gameViewport.height*.5+8)}px`;button.style.left=`${(projected.x*.5+.5)*gameViewport.width}px`;button.style.top=`${(-projected.y*.5+.5)*gameViewport.height}px`;button.setAttribute('aria-pressed',String(def.id===chosen));}
    },
    pick(ray:THREE.Ray){const hit=new THREE.Vector3();if(!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-75),hit))return;let best=220,id:string|undefined;for(const h of SELECTION_HEROES){const d=Math.hypot(hit.x-h.x,hit.y-h.y);if(d<best){best=d;id=h.id;}}return id&&playableSelection(id);},
    dispose(){for(const actor of natives)actor.dispose();for(const mesh of owned){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();}root.removeFromParent();}
  };
}
