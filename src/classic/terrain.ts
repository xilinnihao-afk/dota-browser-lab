import * as THREE from 'three';
import {loadTexture, paths} from './assets';

// This is an explicitly labelled material calibration patch, NOT a DotA map.
// Each tile uses an original 64px tile or transition from the classic BLP atlas.
export async function createTerrain() {
  const [dirt, grass] = await Promise.all([loadTexture(paths.dirt), loadTexture(paths.grass)]);
  const root = new THREE.Group(); root.name = 'Original tileset calibration patch';
  const base:number[] = [], baseUV:number[] = [], overlay:number[] = [], overlayUV:number[] = [];
  const size = 128, half = 16;
  const grassAt = (x:number,y:number) => Math.abs(x - y * .4) > 210 + Math.sin(y / 380) * 60;
  function tile(positions:number[],uvs:number[],x:number,y:number,z:number,column:number,row:number) {
    const epsilon = .3 / 512, u0=column/8+epsilon, u1=(column+1)/8-epsilon;
    const v0=row/4+epsilon, v1=(row+1)/4-epsilon;
    positions.push(x,y,z,x+size,y,z,x+size,y+size,z, x,y,z,x+size,y+size,z,x,y+size,z);
    uvs.push(u0,v0,u1,v0,u1,v1,u0,v0,u1,v1,u0,v1);
  }
  for(let y=-half;y<half;y++) for(let x=-half;x<half;x++) {
    const px=x*size, py=y*size, variation=Math.abs((x*17+y*31+x*y*7))%16;
    const special=Math.abs((x*73856093)^(y*19349663))%9===0;
    tile(base,baseUV,px,py,0,special?4+variation%4:0,special?Math.floor(variation/4):0);
    // The classic atlas orders corner bits TL=8 TR=4 BL=2 BR=1.
    const mask=Number(grassAt(px,py))*8+Number(grassAt(px+size,py))*4+
      Number(grassAt(px,py+size))*2+Number(grassAt(px+size,py+size));
    if(mask) tile(overlay,overlayUV,px,py,.25,mask===15?(special?4+variation%4:0):mask%4,
      mask===15?(special?Math.floor(variation/4):0):Math.floor(mask/4));
  }
  function mesh(positions:number[],uvs:number[],texture:THREE.Texture, alpha:boolean) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
    const result=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({map:texture,transparent:alpha,depthWrite:!alpha,toneMapped:false}));
    if(alpha)result.renderOrder=1;
    root.add(result);return result;
  }
  const ground=mesh(base,baseUV,dirt,false);mesh(overlay,overlayUV,grass,true);
  return {root,ground,dispose(){root.children.forEach(child=>{const mesh=child as THREE.Mesh;mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();});root.removeFromParent();}};
}
