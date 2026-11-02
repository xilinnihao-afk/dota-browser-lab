import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDefinition } from '../game/types';
import { laneCenter, riverCenter, seededRandom, smoothstep, terrainHeight, WATER_LEVEL } from '../game/map';

/** World units are shared with simulation. The only ground height owner is map.ts.
 * Authored stand-in art: no Warcraft assets, original terrain data or textures.
 * Foliage intentionally overlaps within each crown; collision uses the trunk proxy.
 */
export function createWorld(scene: THREE.Scene, map: MapDefinition) {
  const root = new THREE.Group();
  root.name = 'representative-river-crossing';
  scene.add(root);
  const rng = seededRandom(map.seed + 19);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometry = <T extends THREE.BufferGeometry>(g: T) => { geometries.add(g); return g; };
  const material = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .95, ...options });
    materials.add(m); return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const matrix = new THREE.Matrix4();
  const dummy = new THREE.Object3D();
  type Placement = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number; rz?: number; color?: THREE.Color };
  const instanced = (g: THREE.BufferGeometry, m: THREE.Material, records: Placement[], name: string, shadows = true) => {
    const mesh = new THREE.InstancedMesh(g, m, records.length); mesh.name = name;
    records.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); if (p.color) mesh.setColorAt(i, p.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere(); root.add(mesh); return mesh;
  };

  // Terrain is one stable world-space field bundle: height -> moisture/slope -> grass/path colors.
  const terrain = geometry(new THREE.PlaneGeometry(map.size, map.size, 192, 192));
  terrain.rotateX(-Math.PI / 2);
  const pos = terrain.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const grassDry = new THREE.Color('#687746'), grassWet = new THREE.Color('#3a644b');
  const soil = new THREE.Color('#b09a6b'), silt = new THREE.Color('#526e60'), rock = new THREE.Color('#767765');
  const tempColor = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = terrainHeight(x, z); pos.setY(i, y);
    const riverDistance = Math.abs(z - riverCenter(x));
    const pathDistance = Math.abs(x - laneCenter(z));
    const meso = Math.sin(x * .27 + Math.sin(z * .24)) * Math.cos(z * .36 - x * .1);
    const detail = Math.sin(x * 1.63 + z * .91) * Math.sin(z * 1.31 - x * .6);
    const moisture = 1 - smoothstep(6, 16, riverDistance);
    const path = 1 - smoothstep(3.0 + meso * .55, 5.9 + meso * .6, pathDistance);
    const slope = Math.min(1, Math.abs(terrainHeight(x, z + .4) - terrainHeight(x, z - .4)) * 1.7);
    tempColor.copy(grassDry).lerp(grassWet, moisture * .8 + (z < 0 ? .1 : 0));
    tempColor.lerp(soil, path * .87).lerp(rock, slope * .53 * (1 - path));
    tempColor.lerp(silt, (1 - smoothstep(-.5, .55, y)) * .8);
    tempColor.multiplyScalar(1 + meso * .07 + detail * .025);
    tempColor.toArray(colors, i * 3);
  }
  terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3)); terrain.computeVertexNormals();
  const groundMaterial = material('#ffffff', { vertexColors: true, roughness: 1 });
  // Small grayscale dry-brush texture provides readable material scale without external assets.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5200; i++) {
        const v = 175 + Math.floor(rng() * 70); ctx.strokeStyle = `rgba(${v},${v},${v},.22)`;
        const x = rng() * 256, y = rng() * 256;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng() * 4, y + 1 + rng() * 6); ctx.stroke();
      }
      const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(18, 18); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      textures.add(texture); groundMaterial.map = texture;
    }
  }
  const ground = add(terrain, groundMaterial, 'raycast-ground');
  ground.userData.surface = 'terrain';

  // The river ribbon is clipped naturally by the exact terrain, including the shallow ford.
  const waterGeometry = geometry(new THREE.PlaneGeometry(map.size, 16, 144, 18));
  waterGeometry.rotateX(-Math.PI / 2);
  const waterPos = waterGeometry.getAttribute('position');
  const waterColor = new Float32Array(waterPos.count * 3);
  const deep = new THREE.Color('#287b79'), shallow = new THREE.Color('#6caaa0');
  for (let i = 0; i < waterPos.count; i++) {
    const x = waterPos.getX(i), z = waterPos.getZ(i) + riverCenter(x); waterPos.setXYZ(i, x, WATER_LEVEL, z);
    const depth = WATER_LEVEL - terrainHeight(x, z);
    tempColor.copy(shallow).lerp(deep, smoothstep(.05, 1, depth)).toArray(waterColor, i * 3);
  }
  waterGeometry.setAttribute('color', new THREE.BufferAttribute(waterColor, 3)); waterGeometry.computeVertexNormals();
  const water = add(waterGeometry, material('#ffffff', { vertexColors: true, roughness: .38, metalness: .12, transparent: true, opacity: .86, depthWrite: false }), 'river-water');
  water.receiveShadow = true; water.renderOrder = 1;

  const trunkMat = material('#66503a');
  const leafMat = material('#ffffff', { roughness: 1 });
  const stoneMat = material('#ffffff', { flatShading: true });
  const grassMat = material('#ffffff', { side: THREE.DoubleSide, roughness: 1 });
  const trunkPieces: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(.17, .36, 3.4, 7, 3); trunk.translate(0, 1.7, 0); trunkPieces.push(trunk);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, branch = new THREE.CylinderGeometry(.055, .17, 1.8, 5);
    branch.rotateZ(-.65); branch.rotateY(a); branch.translate(Math.cos(a) * .48, 2.6, -Math.sin(a) * .48); trunkPieces.push(branch);
    const rootPiece = new THREE.ConeGeometry(.23, 1.45, 5); rootPiece.rotateZ(Math.PI / 2.8); rootPiece.rotateY(a);
    rootPiece.translate(Math.cos(a) * .36, .22, -Math.sin(a) * .36); trunkPieces.push(rootPiece);
  }
  const treeTrunk = geometry(mergeGeometries(trunkPieces)!); trunkPieces.forEach(g => g.dispose());
  const crown = geometry(new THREE.IcosahedronGeometry(1, 2));
  const cp = crown.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const r = 1 + Math.sin(x * 6 + z * 5) * Math.cos(y * 8 - z * 3) * .055;
    cp.setXYZ(i, x * r, y * r, z * r);
  }
  crown.computeVertexNormals();
  const trunks: Placement[] = [], crowns: Placement[] = [], stones: Placement[] = [], moss: Placement[] = [];
  const shadowRecords: Placement[] = [];
  for (const obstacle of map.obstacles) {
    const { x, z, scale: s } = obstacle, y = terrainHeight(x, z);
    if (obstacle.kind === 'tree') {
      const angle = rng() * Math.PI * 2;
      trunks.push({ x, y, z, sx: s, sy: s, sz: s, ry: angle });
      const northern = z < 0;
      const base = new THREE.Color().setHSL(northern ? .277 + rng() * .035 : .23 + rng() * .045, .34 + rng() * .13, .22 + rng() * .08);
      for (let j = 0; j < 5; j++) {
        const a = j * 2.4 + angle, side = j === 4 ? 0 : .95 * s, radius = j === 4 ? 1.65 : 1.45;
        const color = base.clone().multiplyScalar(.88 + j * .055);
        crowns.push({ x: x + Math.cos(a) * side, y: y + (j === 4 ? 4.9 : 3.7 + j % 2 * .55) * s, z: z + Math.sin(a) * side, sx: radius * s, sy: (j === 4 ? 1.65 : 1.28) * s, sz: radius * s, ry: a, color });
      }
      shadowRecords.push({ x, y: y + .025, z, sx: 2.2 * s, sy: 2.2 * s, sz: 1, rx: -Math.PI / 2 });
    } else if (obstacle.kind === 'rock') {
      stones.push({ x, y: y + .5 * s, z, sx: s, sy: s * .8, sz: s * .85, ry: rng() * 6, rz: rng() * .3, color: new THREE.Color().setHSL(.115, .09, .39 + rng() * .13) });
      moss.push({ x: x - .12, y: y + 1.02 * s, z: z + .08, sx: s * .65, sy: s * .15, sz: s * .65, color: new THREE.Color('#657747') });
    }
  }
  instanced(treeTrunk, trunkMat, trunks, 'forest-trunks');
  instanced(crown, leafMat, crowns, 'clustered-tree-canopies');
  const rockGeo = geometry(new THREE.DodecahedronGeometry(1, 0));
  instanced(rockGeo, stoneMat, stones, 'river-bank-boulders');
  instanced(crown, leafMat, moss, 'boulder-moss', false);

  // Soft painted contact shadows ground foliage without hundreds of shadow lights.
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32); gradient.addColorStop(0, 'rgba(20,35,18,.25)'); gradient.addColorStop(.6, 'rgba(20,35,18,.13)'); gradient.addColorStop(1, 'rgba(20,35,18,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c); textures.add(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }); materials.add(mat);
      instanced(geometry(new THREE.PlaneGeometry(2, 2)), mat, shadowRecords, 'foliage-contact-shadows', false);
    }
  }

  const bladePos: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4, dx = Math.cos(a), dz = Math.sin(a), h = .35 + i % 3 * .13;
    bladePos.push(dx * -.12, 0, dz * -.12, dx * .12, 0, dz * .12, dx * .2, h, dz * .2);
  }
  const grassGeo = geometry(new THREE.BufferGeometry()); grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3)); grassGeo.computeVertexNormals();
  const grass: Placement[] = [], pebbles: Placement[] = [], cobbles: Placement[] = [], reeds: Placement[] = [];
  for (let i = 0; i < 3600; i++) {
    const x = (rng() - .5) * 92, z = (rng() - .5) * 92;
    const rd = Math.abs(z - riverCenter(x)), ld = Math.abs(x - laneCenter(z));
    if (rd < 7.8 || ld < 3.4 || map.obstacles.some(o => o.kind === 'tower' && Math.hypot(x - o.x, z - o.z) < 3)) continue;
    const s = .55 + rng() * .8;
    grass.push({ x, y: terrainHeight(x, z) + .015, z, sx: s, sy: s, sz: s, ry: rng() * 6.28, color: new THREE.Color().setHSL(.22 + rng() * .06, .38, .27 + rng() * .13) });
  }
  for (let i = 0; i < 350; i++) {
    const z = (rng() - .5) * 92, x = laneCenter(z) + (rng() - .5) * 6.6;
    if (Math.abs(z - riverCenter(x)) < 3.5) continue;
    const s = .12 + rng() * .23;
    pebbles.push({ x, y: terrainHeight(x, z) + .04, z, sx: s, sy: s * .38, sz: s * .85, ry: rng() * 6.28, color: new THREE.Color('#adab88').multiplyScalar(.7 + rng() * .4) });
  }
  for (let z = -44; z < 45; z += 2.0) {
    if (Math.abs(z) < 5.5 || Math.abs(z) > 34) continue;
    for (let k = 0; k < 2; k++) {
      if (rng() < .36) continue;
      const x = laneCenter(z) + (k === 0 ? -3.9 : 3.9) + (rng() - .5) * .6;
      cobbles.push({ x, y: terrainHeight(x, z) + .075, z, sx: .45 + rng() * .2, sy: .15, sz: .65 + rng() * .2, ry: rng() * .5, color: new THREE.Color('#96947b').multiplyScalar(.85 + rng() * .25) });
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = (rng() - .5) * 92; if (Math.abs(x) < 8) continue;
    const z = riverCenter(x) + (rng() < .5 ? -1 : 1) * (6.1 + rng() * 1.5), s = 1 + rng();
    reeds.push({ x, y: terrainHeight(x, z), z, sx: s * .6, sy: s * 1.7, sz: s * .6, ry: rng() * 6.28, color: new THREE.Color('#85864c').multiplyScalar(.7 + rng() * .4) });
  }
  instanced(grassGeo, grassMat, grass, 'grass-tufts', false);
  instanced(grassGeo, grassMat, reeds, 'shore-reeds', false);
  instanced(rockGeo, stoneMat, [...pebbles, ...cobbles], 'worn-road-stones', false);

  // Water movement is small, slow, and world anchored. No expensive reflection pass.
  const flowRecords: Placement[] = [];
  for (let i = 0; i < 100; i++) {
    const x = (rng() - .5) * 94, z = riverCenter(x) + (rng() - .5) * 9;
    if (terrainHeight(x, z) > WATER_LEVEL - .08) continue;
    flowRecords.push({ x, y: WATER_LEVEL + .028, z, sx: .25 + rng() * 1.6, sy: .015 + rng() * .03, sz: 1, rx: -Math.PI / 2, ry: 0, rz: Math.cos(x * .065) * .24 });
  }
  const flowMat = new THREE.MeshBasicMaterial({ color: '#b4d4b8', transparent: true, opacity: .24, depthWrite: false }); materials.add(flowMat);
  const flow = instanced(geometry(new THREE.PlaneGeometry(1, 1)), flowMat, flowRecords, 'river-flow-highlights', false); flow.renderOrder = 2;

  // Low boundary slopes conceal the finite tile from an oblique camera.
  const sideMat = material('#4c5140');
  for (const sign of [-1, 1]) {
    const cliff = add(geometry(new THREE.BoxGeometry(map.size, 5.6, .8)), sideMat, `map-edge-z-${sign}`);
    cliff.position.set(0, -.5, sign * map.size / 2); cliff.castShadow = false;
    const side = add(geometry(new THREE.BoxGeometry(.8, 5.6, map.size)), sideMat, `map-edge-x-${sign}`);
    side.position.set(sign * map.size / 2, -.5, 0);
  }
  root.userData.artSource = 'Original procedural milestone stand-ins';
  root.userData.fields = ['terrainHeight', 'riverDistance', 'pathDistance', 'moisture', 'slope'];
  return {
    ground,
    update(time: number) {
      flowRecords.forEach((p, i) => {
        const x = p.x + Math.sin(time * .38 + i) * .35;
        dummy.position.set(x, p.y, p.z); dummy.rotation.set(p.rx || 0, 0, p.rz || 0);
        dummy.scale.set(p.sx * (1 + Math.sin(time + i) * .15), p.sy, 1); dummy.updateMatrix();
        matrix.copy(dummy.matrix); flow.setMatrixAt(i, matrix);
      });
      flow.instanceMatrix.needsUpdate = true;
      flowMat.opacity = .18 + Math.sin(time * .8) * .035;
    },
    dispose() { root.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); },
  };
}
