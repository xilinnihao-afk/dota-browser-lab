import * as THREE from 'three';

type LitMaterial=THREE.MeshBasicMaterial|THREE.MeshLambertMaterial;
export function materialKey(m:LitMaterial){return [m.type,m.map?.uuid,m.side,m.transparent,m.depthWrite,m.alphaTest,m.blending,m.blendSrc,m.blendDst,m.blendSrcAlpha,m.blendDstAlpha,m.opacity,m.customProgramCacheKey()].join('|');}
interface Batch{material:LitMaterial;order:number;positions:number[];normals:number[];uvs:number[];colors:number[];indices:number[];}
/** Full-map geometry is small enough to bake transformed vertices once. Batch by
 * native layer state, retaining every source face, UV, instance color and position. */
export function bakeWorld(root:THREE.Object3D){
  root.updateWorldMatrix(true,true);const batches=new Map<string,Batch>(),p=new THREE.Vector3(),n=new THREE.Vector3(),color=new THREE.Color(),matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
  root.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||!o.visible||o.name.startsWith('PRE2/')||o.name.startsWith('ribbon/'))return;
    const material=o.material as LitMaterial;if(!material.color)return;
    // Animated UV layers deliberately retain their own uniform owner.
    const key=materialKey(material)+(material.userData.nativeUV?'|'+material.uuid:'')+'|'+o.renderOrder;
    if(!batches.has(key)){const m=material.clone();m.color.setRGB(1,1,1);m.vertexColors=true;m.onBeforeCompile=material.onBeforeCompile;m.customProgramCacheKey=material.customProgramCacheKey;batches.set(key,{material:m,order:o.renderOrder,positions:[],normals:[],uvs:[],colors:[],indices:[]});}
    const b=batches.get(key)!,g=o.geometry,position=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv'),vertexColor=g.getAttribute('color');
    if(!position||!position.count)return;
    for(let instance=0;instance<(o instanceof THREE.InstancedMesh?o.count:1);instance++){
      color.copy(material.color);
      if(o instanceof THREE.InstancedMesh){o.getMatrixAt(instance,matrix);matrix.premultiply(o.matrixWorld);if(o.instanceColor){const c=new THREE.Color();o.getColorAt(instance,c);color.multiply(c);}}else matrix.copy(o.matrixWorld);
      normalMatrix.getNormalMatrix(matrix);const offset=b.positions.length/3;
      for(let i=0;i<position.count;i++){
        p.fromBufferAttribute(position,i).applyMatrix4(matrix);b.positions.push(p.x,p.y,p.z);
        n.set(0,0,1);if(normal)n.fromBufferAttribute(normal,i);n.applyNormalMatrix(normalMatrix);b.normals.push(n.x,n.y,n.z);
        b.uvs.push(uv?.getX(i)??0,uv?.getY(i)??0);
        b.colors.push(color.r*(vertexColor?.getX(i)??1),color.g*(vertexColor?.getY(i)??1),color.b*(vertexColor?.getZ(i)??1),vertexColor?.itemSize===4?vertexColor.getW(i):1);
      }
      const count=g.index?.count??position.count;for(let i=0;i<count;i++)b.indices.push(offset+(g.index?.getX(i)??i));
    }
  });
  const group=new THREE.Group();
  for(const b of batches.values()){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(b.colors,4));g.setIndex(b.indices);g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,b.material);mesh.renderOrder=b.order;group.add(mesh);
  }return group;
}
export function disposeBaked(group:THREE.Group){for(const child of group.children){const mesh=child as THREE.Mesh;mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}group.removeFromParent();}

/** Combine already simulated world-space PRE2 quads without changing effects. */
export class ParticleBatches{
  readonly root=new THREE.Group();
  private batches=new Map<string,{mesh:THREE.Mesh;capacity:number}>();
  update(sources:THREE.Mesh[]){
    const groups=new Map<string,THREE.Mesh[]>();
    for(const mesh of sources){if(!mesh.visible||!mesh.geometry.drawRange.count)continue;const key=materialKey(mesh.material as LitMaterial)+'|'+mesh.renderOrder;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(mesh);}
    for(const b of this.batches.values())b.mesh.visible=false;
    for(const [key,list]of groups){
      const quads=list.reduce((sum,m)=>sum+m.geometry.drawRange.count/6,0);let b=this.batches.get(key);
      if(!b){b={mesh:new THREE.Mesh(new THREE.BufferGeometry(),list[0].material),capacity:0};b.mesh.frustumCulled=false;b.mesh.renderOrder=list[0].renderOrder;this.root.add(b.mesh);this.batches.set(key,b);}
      if(quads>b.capacity){b.capacity=Math.max(64,2**Math.ceil(Math.log2(quads)));b.mesh.geometry.dispose();const g=b.mesh.geometry=new THREE.BufferGeometry();
        for(const [name,size]of [['position',3],['normal',3],['uv',2],['color',4]] as const)g.setAttribute(name,new THREE.BufferAttribute(new Float32Array(b.capacity*4*size),size).setUsage(THREE.DynamicDrawUsage));
        const indices=[];for(let i=0;i<b.capacity;i++){const n=i*4;indices.push(n,n+1,n+2,n,n+2,n+3);}g.setIndex(indices);
      }
      let offset=0;for(const mesh of list){const count=mesh.geometry.drawRange.count/6*4;for(const name of ['position','normal','uv','color']){const src=mesh.geometry.getAttribute(name),dst=b.mesh.geometry.getAttribute(name)as THREE.BufferAttribute;(dst.array as Float32Array).set((src.array as Float32Array).subarray(0,count*src.itemSize),offset*src.itemSize);}offset+=count;}
      for(const a of Object.values(b.mesh.geometry.attributes)){const attr=a as THREE.BufferAttribute;attr.clearUpdateRanges();attr.addUpdateRange(0,quads*4*attr.itemSize);attr.needsUpdate=true;}
      b.mesh.geometry.setDrawRange(0,quads*6);b.mesh.visible=true;
    }
  }
  dispose(){for(const b of this.batches.values())b.mesh.geometry.dispose();this.root.removeFromParent();this.batches.clear();}
}
