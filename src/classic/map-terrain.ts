import * as THREE from 'three';
import {bakeWorld,disposeBaked} from './batching';
import {loadTexture,loadModel} from './assets';
import {atlasCell,cornerAt,heightAt,type MapData} from './map-data';

type Bucket={p:number[];uv:number[];n:number[];color:number[]};
const bucket=():Bucket=>({p:[],uv:[],n:[],color:[]});
function geometry(b:Bucket){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));
  if(b.n.length)g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));else g.computeVertexNormals();
  if(b.color.length)g.setAttribute('color',new THREE.Float32BufferAttribute(b.color,4));
  g.computeBoundingSphere();return g;
}

export async function createMapTerrain(map:MapData){
  const root=new THREE.Group(),ground=new THREE.Group(),cliffGroup=new THREE.Group(),waterGroup=new THREE.Group();root.add(ground,cliffGroup,waterGroup);
  const textures=await Promise.all(map.tiles.map(t=>loadTexture(t.path)));
  const cliffTextures=await Promise.all(map.cliffs.map(t=>loadTexture(t.path,3)));
  let shadow:THREE.DataTexture|undefined;
  if(map.shadow){const response=await fetch(`${import.meta.env.BASE_URL}assets/imba/resources/${map.shadow.path}`);if(!response.ok)throw new Error('Missing source terrain shadow');const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==map.shadow.width*map.shadow.height)throw new Error('Invalid SHD dimensions');
    shadow=new THREE.DataTexture(bytes,map.shadow.width,map.shadow.height,THREE.RedFormat);shadow.magFilter=shadow.minFilter=THREE.LinearFilter;shadow.needsUpdate=true;
  }
  function sourceShadow(material:THREE.Material){
    if(!shadow)return;
    material.onBeforeCompile=shader=>{
      shader.uniforms.warcraftShadow={value:shadow};
      shader.vertexShader='varying vec2 vWarcraftShadowUV;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvWarcraftShadowUV = (position.xy - vec2(${map.offset[0].toFixed(1)}, ${map.offset[1].toFixed(1)})) / vec2(${((map.width-1)*128).toFixed(1)}, ${((map.height-1)*128).toFixed(1)});`);
      shader.fragmentShader='uniform sampler2D warcraftShadow;\nvarying vec2 vWarcraftShadowUV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - texture2D(warcraftShadow, vWarcraftShadowUV).r * 0.45;');
    };material.customProgramCacheKey=()=>`w3e-shadow-${map.source.sha256}`;
  }
  const cliffCells=new Set([...map.cliffInstances.map(c=>c.y*(map.width-1)+c.x),...map.rampCells]);
  const buckets=new Map<string,Bucket>();
  const isCliff=(x:number,y:number)=>cliffCells.has(y*(map.width-1)+x);
  function tileIndex(x:number,y:number){
    for(let dy=-1;dy<=0;dy++)for(let dx=-1;dx<=0;dx++)if(x+dx>0&&y+dy>0&&x+dx<map.width-2&&y+dy<map.height-2&&isCliff(x+dx,y+dy)){
      const t=cornerAt(map,x+dx,y+dy)[5];return Math.max(0,map.cliffs[t===15?1:t].ground);
    }
    const c=cornerAt(map,x,y);return c[8]?map.tiles.length-1:c[2];
  }
  const vertices=[[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]];
  for(let y=0;y<map.height-1;y++)for(let x=0;x<map.width-1;x++){
    if(isCliff(x,y))continue;
    const indices=[tileIndex(x,y),tileIndex(x+1,y),tileIndex(x,y+1),tileIndex(x+1,y+1)];
    const layers=[...new Set(indices)].sort((a,b)=>a-b);
    for(let layer=0;layer<layers.length;layer++){
      const t=layers[layer],def=map.tiles[t],alpha=layer>0;
      const mask=Number(indices[0]===t)*2+Number(indices[1]===t)+Number(indices[2]===t)*8+Number(indices[3]===t)*4;
      const [col,row]=alpha?[mask%4,Math.floor(mask/4)]:atlasCell(cornerAt(map,x,y)[3],def.width>def.height);
      const key=`${Math.floor(x/16)},${Math.floor(y/16)},${t},${Number(alpha)}`;
      if(!buckets.has(key))buckets.set(key,bucket());const b=buckets.get(key)!;
      const columns=def.width>def.height?8:4;
      for(const [dx,dy] of vertices){
        const c=cornerAt(map,x+dx,y+dy);b.p.push(map.offset[0]+(x+dx)*128,map.offset[1]+(y+dy)*128,c[0]+layer*.08);
        b.uv.push((col+(dx===0?.008:.992))/columns,(row+(dy===0?.992:.008))/4);
        // Shared height-field normals prevent diagonal seams between tile layers.
        const nx=cornerAt(map,x+dx-1,y+dy)[0]-cornerAt(map,x+dx+1,y+dy)[0];
        const ny=cornerAt(map,x+dx,y+dy-1)[0]-cornerAt(map,x+dx,y+dy+1)[0];
        const n=new THREE.Vector3(nx,ny,256).normalize();b.n.push(n.x,n.y,n.z);
      }
    }
  }
  const mats=new Map<string,THREE.Material>();
  for(const [key,b] of buckets){const parts=key.split(','),t=Number(parts[2]),alpha=parts[3]==='1',mk=`${t}/${alpha}`;
    if(!mats.has(mk)){const material=new THREE.MeshLambertMaterial({map:textures[t],transparent:alpha,depthWrite:!alpha,toneMapped:false});sourceShadow(material);mats.set(mk,material);}
    const mesh=new THREE.Mesh(geometry(b),mats.get(mk)!);mesh.renderOrder=alpha?t+1:0;ground.add(mesh);
  }
  const cliffBuckets=new Map<string,Bucket>();
  const cliffSources=[...map.cliffInstances,...map.rampInstances];
  const models=new Map(await Promise.all([...new Set(cliffSources.map(c=>c.path))].map(async p=>[p,await loadModel(p)] as const)));
  for(const c of cliffSources){
    const m=models.get(c.path)!,key=`${Math.floor(c.x/16)},${Math.floor(c.y/16)},${c.type}`;
    if(!cliffBuckets.has(key))cliffBuckets.set(key,bucket());const b=cliffBuckets.get(key)!;
    for(const geo of m.Geosets)for(const index of geo.Faces){
      const x=map.offset[0]+(c.x+(c.sx??1))*128+geo.Vertices[index*3],y=map.offset[1]+c.y*128+geo.Vertices[index*3+1];
      b.p.push(x,y,c.base+geo.Vertices[index*3+2]+heightAt(map,x,y,true));
      b.uv.push(geo.TVertices[0][index*2],geo.TVertices[0][index*2+1]);b.n.push(...geo.Normals.subarray(index*3,index*3+3));
    }
  }
  const cliffMats=cliffTextures.map(map=>new THREE.MeshLambertMaterial({map,toneMapped:false}));
  cliffMats.forEach(sourceShadow);
  for(const [key,b] of cliffBuckets)cliffGroup.add(new THREE.Mesh(geometry(b),cliffMats[Number(key.split(',')[2])]));
  const waterFrames=await Promise.all(map.water.paths.map(p=>loadTexture(p,3))),waterBuckets=new Map<string,Bucket>(),params=map.water.parameters;
  for(let y=0;y<map.height-1;y++)for(let x=0;x<map.width-1;x++){
    if(![cornerAt(map,x,y),cornerAt(map,x+1,y),cornerAt(map,x,y+1),cornerAt(map,x+1,y+1)].some(c=>c[9]))continue;
    const key=`${Math.floor(x/16)},${Math.floor(y/16)}`;if(!waterBuckets.has(key))waterBuckets.set(key,bucket());const b=waterBuckets.get(key)!;
    for(const [dx,dy]of vertices){const c=cornerAt(map,x+dx,y+dy),z=c[1]+map.water.height,depth=Math.max(0,z-c[0]);
      b.p.push(map.offset[0]+(x+dx)*128,map.offset[1]+(y+dy)*128,z);b.uv.push(dx,1-dy);
      const shallow=depth<=64,t=shallow?Math.max(0,depth-10)/54:Math.min(1,(depth-64)/8),prefix=shallow?'s':'d';
      for(let i=0;i<4;i++){const ch=['r','g','b','a'][i];b.color.push((Number(params[prefix+'min_'+ch])*(1-t)+Number(params[prefix+'max_'+ch])*t)/255*(map.water.baseColor[i]??1));}
    }
  }
  const waterMat=new THREE.MeshBasicMaterial({map:waterFrames[0],transparent:true,depthWrite:false,vertexColors:true,toneMapped:false,side:THREE.DoubleSide});
  for(const b of waterBuckets.values()){const mesh=new THREE.Mesh(geometry(b),waterMat);mesh.renderOrder=20;waterGroup.add(mesh);}
  const farGround=bakeWorld(ground),farCliffs=bakeWorld(cliffGroup),farWater=bakeWorld(waterGroup);
  // Water shares its live frame material; no copy can get stuck on frame zero.
  farWater.traverse(o=>{if(o instanceof THREE.Mesh){(o.material as THREE.Material).dispose();o.material=waterMat;}});
  root.add(farGround,farCliffs,farWater);let time=0,far=false;
  function setFar(value:boolean){far=value;ground.visible=cliffGroup.visible=!far;farGround.visible=farCliffs.visible=far;farWater.visible=far&&waterGroup.visible;}
  setFar(false);
  return {root,ground,cliffGroup,waterGroup,farGround,farCliffs,farWater,setFar,update(delta:number){farWater.visible=far&&waterGroup.visible;for(const child of waterGroup.children)child.visible=!far;time+=delta;waterMat.map=waterFrames[Math.floor(time*map.water.rate)%waterFrames.length];},dispose(){disposeBaked(farGround);disposeBaked(farCliffs);for(const child of farWater.children)(child as THREE.Mesh).geometry.dispose();farWater.removeFromParent();root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});mats.forEach(m=>m.dispose());cliffMats.forEach(m=>m.dispose());waterMat.dispose();shadow?.dispose();root.removeFromParent();}};
}
