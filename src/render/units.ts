import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Unit } from '../game/types';

export interface UnitVisual {
  root: THREE.Group;
  update(unit: Unit, dt: number, time: number): void;
  dispose(): void;
}

/** Original low-poly stand-ins. +Y up, +Z forward; root origin is the feet.
 * Named parts remain separate through construction, then static pieces merge
 * by material inside each articulated joint. Gameplay owns position/facing.
 */
export function createUnitVisual(unit: Unit): UnitVisual {
  const root = new THREE.Group(); root.name = `${unit.kind}-${unit.id}`; root.userData.unitId = unit.id;
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.MeshStandardMaterial>();
  const makeMaterial = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: .05, ...opts });
    m.userData.originalEmissive = m.emissive.clone(); m.userData.originalIntensity = m.emissiveIntensity;
    materials.add(m); return m;
  };
  const steel = makeMaterial('#92abb2', { metalness: .32, roughness: .63 });
  const steelDark = makeMaterial('#3d555e', { metalness: .18 });
  const trim = makeMaterial('#b8a46b', { metalness: .32, roughness: .65 });
  const leather = makeMaterial('#433b33');
  const ally = unit.team === 'allied';
  const cloth = makeMaterial(ally ? '#277b9a' : '#a74c31', { side: THREE.DoubleSide });
  const clothDark = makeMaterial(ally ? '#174e62' : '#6e3026', { side: THREE.DoubleSide });
  const glow = makeMaterial(ally ? '#8cddde' : '#e99558', { emissive: ally ? '#258b9e' : '#ba4d1c', emissiveIntensity: .5 });
  const skin = makeMaterial('#7a8555');
  const stone = makeMaterial('#777b6c'), lightStone = makeMaterial('#a0a28d'), shadowStone = makeMaterial('#555d52');
  const add = (parent: THREE.Object3D, name: string, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    geometries.add(g); const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const joint = (parent: THREE.Object3D, name: string, x: number, y: number, z: number) => {
    const group = new THREE.Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group;
  };
  const profile = (points: [number, number][], depth: number, bevel = .025) => {
    const shape = new THREE.Shape(); shape.moveTo(points[0][0], points[0][1]); points.slice(1).forEach(p => shape.lineTo(p[0], p[1])); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSegments: 1, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 4 });
    g.translate(0, 0, -depth / 2); return g;
  };
  // Shared section rings produce a continuous armor silhouette, including edge bevels.
  const loft = (rings: [number, number, number][], sides = 8) => {
    const positions: number[] = [], indices: number[] = [];
    rings.forEach(([y, rx, rz]) => {
      for (let j = 0; j < sides; j++) { const a = j * Math.PI * 2 / sides + Math.PI / sides; positions.push(Math.cos(a) * rx, y, Math.sin(a) * rz); }
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      indices.push(a, c, b, b, c, d);
    }
    const bottom = positions.length / 3; positions.push(0, rings[0][0], 0);
    const top = positions.length / 3; positions.push(0, rings[rings.length - 1][0], 0);
    for (let j = 0; j < sides; j++) {
      indices.push(bottom, j, (j + 1) % sides);
      const k = (rings.length - 1) * sides; indices.push(top, k + (j + 1) % sides, k + j);
    }
    const indexed = new THREE.BufferGeometry(); indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); indexed.setIndex(indices);
    const g = indexed.toNonIndexed(); indexed.dispose(); g.computeVertexNormals(); return g;
  };
  const beveledBox = (w: number, h: number, d: number, bevel = .05) => profile([[-w / 2 + bevel, -h / 2], [w / 2 - bevel, -h / 2], [w / 2, -h / 2 + bevel], [w / 2, h / 2 - bevel], [w / 2 - bevel, h / 2], [-w / 2 + bevel, h / 2], [-w / 2, h / 2 - bevel], [-w / 2, -h / 2 + bevel]], d - bevel * 2, bevel);
  const mergeStatic = (parent: THREE.Group) => {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    parent.children.slice().forEach(child => {
      if (child instanceof THREE.Group) mergeStatic(child);
      else if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
        const bucket = buckets.get(child.material) || []; bucket.push(child); buckets.set(child.material, bucket);
      }
    });
    buckets.forEach((meshes, material) => {
      if (meshes.length < 2) return;
      const pieces = meshes.map(mesh => {
        mesh.updateMatrix(); let g = mesh.geometry.clone();
        if (g.index) { const old = g; g = g.toNonIndexed(); old.dispose(); }
        // Builders emit UVs only where needed; color/material ownership is per mesh.
        for (const attribute of Object.keys(g.attributes)) if (attribute !== 'position' && attribute !== 'normal') g.deleteAttribute(attribute);
        g.applyMatrix4(mesh.matrix); return g;
      });
      const merged = mergeGeometries(pieces); pieces.forEach(p => p.dispose());
      if (!merged) return;
      const mesh = add(parent, meshes.map(m => m.name).join('+'), merged, material);
      mesh.userData.parts = meshes.map(m => m.name); meshes.forEach(m => m.removeFromParent());
    });
  };

  let animate: (unit: Unit, dt: number, time: number) => void;
  if (unit.kind === 'tower') {
    const alive = joint(root, 'intact-tower', 0, 0, 0), ruin = joint(root, 'collapsed-tower', 0, 0, 0);
    const body = joint(alive, 'stone-masonry', 0, 0, 0);
    add(body, 'foundation-lower', loft([[0, 2.15, 2.15], [.12, 2.25, 2.25], [.44, 2.25, 2.25], [.55, 1.96, 1.96]], 8), shadowStone);
    add(body, 'foundation-coping', loft([[.52, 1.96, 1.96], [.65, 2.08, 2.08], [.85, 2.08, 2.08], [.94, 1.75, 1.75]], 8), lightStone);
    add(body, 'tapered-watchtower', loft([[.91, 1.68, 1.68], [1.06, 1.72, 1.72], [2.2, 1.35, 1.35], [4.8, 1.2, 1.2], [5.18, 1.4, 1.4]], 8), stone);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const buttress = add(body, `buttress-${i}`, profile([[-.32, .7], [.32, .7], [.24, 3.5], [.05, 4], [-.32, 3.6]], .62, .045), lightStone, Math.sin(a) * 1.47, 0, Math.cos(a) * 1.47);
      buttress.rotation.y = a;
    }
    [1.3, 2.7, 4.15].forEach((y, i) => add(body, `stone-belt-${i}`, loft([[y, 1.39 - i * .07, 1.39 - i * .07], [y + .12, 1.42 - i * .07, 1.42 - i * .07], [y + .22, 1.39 - i * .07, 1.39 - i * .07]], 8), shadowStone));
    add(body, 'battlement-underhang', loft([[4.9, 1.27, 1.27], [5.15, 1.73, 1.73], [5.43, 1.73, 1.73], [5.55, 1.64, 1.64]], 8), lightStone);
    add(body, 'battlement-crown', loft([[5.5, 1.59, 1.59], [5.9, 1.59, 1.59]], 8), shadowStone);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, battlement = add(body, `merlon-${i}`, beveledBox(.7, .85, .5, .065), lightStone, Math.sin(a) * 1.43, 5.93, Math.cos(a) * 1.43); battlement.rotation.y = a;
    }
    add(body, 'crystal-socket', loft([[5.76, .7, .7], [5.95, .75, .75], [6.14, .5, .5]], 8), trim);
    const crystal = joint(alive, 'defense-crystal', 0, 6.65, 0);
    add(crystal, 'faceted-power-stone', loft([[-.6, .04, .04], [-.23, .5, .5], [.36, .4, .4], [.9, .02, .02]], 6), glow);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const support = add(body, `crystal-prong-${i}`, profile([[-.1, 5.76], [.1, 5.76], [.08, 6.75], [-.05, 6.4]], .14, .02), trim, Math.sin(a) * .75, 0, Math.cos(a) * .75); support.rotation.y = a;
    }
    const banner = joint(alive, 'faction-banner', 0, 0, 0);
    add(banner, 'banner-pole', new THREE.CylinderGeometry(.045, .045, 1.85, 6), trim, 0, 4.7, 1.37).rotation.z = Math.PI / 2;
    add(banner, 'forked-banner', profile([[-.65, 4.65], [.65, 4.65], [.65, 3.05], [.2, 3.26], [0, 2.92], [-.2, 3.26], [-.65, 3.05]], .045, .015), cloth, 0, 0, 1.4);
    add(banner, 'banner-crest', profile([[0, -.37], [.25, -.05], [.19, .29], [0, .39], [-.19, .29], [-.25, -.05]], .035, .015), trim, 0, 3.92, 1.45);
    // Rubble remains supported by the foundation; dead towers stop showing the beacon.
    add(ruin, 'ruin-base', loft([[0, 2.15, 2.15], [.42, 2.2, 2.2], [.75, 1.8, 1.8]], 8), shadowStone);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.399, r = .3 + i % 4 * .42;
      const chunk = add(ruin, `fallen-masonry-${i}`, beveledBox(.8 + i % 3 * .2, .55 + i % 4 * .25, .8, .07), i % 2 ? stone : lightStone, Math.sin(a) * r, .7 + i % 3 * .12, Math.cos(a) * r);
      chunk.rotation.set(i * .13, a, i * .19);
    }
    mergeStatic(root); ruin.visible = false;
    animate = (u, _dt, time) => {
      alive.visible = u.status !== 'dead'; ruin.visible = u.status === 'dead';
      crystal.rotation.y = time * .23; crystal.position.y = 6.65 + Math.sin(time * 1.7) * .06;
      crystal.scale.setScalar(u.status === 'windup' ? 1.12 : 1);
    };
  } else {
    const hero = unit.kind === 'hero';
    const rig = joint(root, 'articulated-body', 0, 0, 0);
    if (!hero) rig.scale.setScalar(.71);
    const torso = joint(rig, 'torso', 0, 0, 0);
    const armor = hero ? steel : cloth;
    add(torso, 'padded-undercoat', loft([[1.12, .48, .32], [1.35, .53, .34], [1.92, .44, .29], [2.48, .65, .35]], 8), clothDark);
    add(torso, 'sculpted-breastplate', loft([[1.57, .4, .27], [1.64, .46, .31], [2.22, .68, .39], [2.46, .62, .34], [2.52, .52, .29]], 8), armor);
    add(torso, 'waist-belt', loft([[1.45, .49, .35], [1.58, .51, .36], [1.68, .47, .33]], 8), leather);
    add(torso, 'belt-buckle', beveledBox(.27, .22, .09, .025), trim, 0, 1.57, .38);
    add(torso, 'chest-sigil', profile([[0, -.29], [.2, .05], [0, .31], [-.2, .05]], .045, .018), hero ? trim : steelDark, 0, 2.12, .4);
    add(torso, 'collar', loft([[2.41, .37, .29], [2.62, .31, .25]], 8), steelDark);
    for (const side of [-1, 1]) {
      const plate = add(torso, `hip-tasset-${side}`, profile([[-.22, -.42], [.22, -.34], [.23, .3], [-.23, .3]], .12, .03), armor, side * .38, 1.22, .31); plate.rotation.z = side * .11;
    }
    const head = joint(rig, 'head', 0, 2.75, 0);
    if (hero) {
      add(head, 'full-helm', loft([[-.22, .24, .24], [-.14, .36, .33], [.3, .37, .34], [.48, .2, .24], [.52, .08, .15]], 8), steel);
      add(head, 'helm-brow', profile([[-.36, .12], [-.27, .25], [0, .21], [.27, .25], [.36, .12], [.28, .05], [0, .09], [-.28, .05]], .085, .018), trim, 0, 0, .31);
      add(head, 'visor-open-shadow', beveledBox(.52, .11, .045, .015), steelDark, 0, .03, .345);
      add(head, 'visor-light', beveledBox(.34, .034, .035, .009), glow, 0, .043, .38);
      add(head, 'nasal-guard', profile([[-.06, -.21], [.06, -.21], [.09, .19], [-.09, .19]], .065, .012), steel, 0, 0, .39);
      const crest = add(head, 'helm-crest', profile([[-.26, .34], [.18, .34], [.32, .6], [.04, .78], [-.31, .63]], .12, .015), cloth, 0, 0, -.03); crest.rotation.y = Math.PI / 2;
    } else {
      const face = add(head, 'goblin-head', new THREE.IcosahedronGeometry(.43, 1), skin, 0, .02, .07); face.scale.set(1, .9, 1);
      for (const side of [-1, 1]) {
        add(head, `pointed-ear-${side}`, profile([[0, -.08], [side * .51, .27], [side * .1, .22]], .12, .015), skin, side * .26, .05, -.03);
        add(head, `eye-${side}`, beveledBox(.13, .08, .04, .01), glow, side * .16, .09, .42);
      }
      add(head, 'goblin-nose', loft([[-.16, .11, .17], [.05, .13, .21], [.12, .06, .06]], 5), skin, 0, .03, .38);
      add(head, 'iron-skullcap', loft([[.15, .43, .38], [.36, .34, .32], [.49, .05, .1]], 8), steelDark);
      add(head, 'helmet-spike', new THREE.ConeGeometry(.1, .48, 5), trim, 0, .65, 0);
    }
    const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const leg = joint(rig, side < 0 ? 'right-hip' : 'left-hip', side * .28, 1.35, 0); legs.push(leg);
      add(leg, 'armored-thigh', loft([[-.64, .22, .22], [-.54, .26, .25], [-.09, .25, .26], [.02, .21, .22]], 7), steelDark);
      add(leg, 'knee-guard', profile([[-.21, -.13], [0, -.25], [.21, -.13], [.2, .19], [0, .26], [-.2, .19]], .12, .025), armor, 0, -.62, .21);
      add(leg, 'greave', loft([[-1.18, .19, .22], [-1.08, .22, .22], [-.77, .2, .2], [-.72, .23, .25]], 7), armor);
      add(leg, 'boot', beveledBox(.43, .29, .66, .05), leather, 0, -1.19, .13);
      add(leg, 'toe-guard', beveledBox(.44, .17, .28, .035), steelDark, 0, -1.14, .35);
      const arm = joint(rig, side < 0 ? 'sword-shoulder' : 'shield-shoulder', side * .66, 2.36, 0); arms.push(arm);
      add(arm, 'upper-arm', loft([[-.61, .17, .18], [-.11, .24, .24], [.05, .25, .24]], 7), clothDark);
      add(arm, 'sculpted-pauldron', profile([[-.36, -.08], [-.33, .25], [0, .39], [.33, .25], [.36, -.08], [.2, -.2], [-.2, -.2]], .59, .035), armor, side * .05, .03, .015);
      add(arm, 'pauldron-gold-ridge', profile([[-.3, .21], [0, .34], [.3, .21], [.28, .16], [0, .27], [-.28, .16]], .64, .012), trim, side * .05, .03, .015);
      add(arm, 'gauntlet', loft([[-.94, .17, .18], [-.86, .23, .24], [-.58, .24, .23], [-.52, .19, .2]], 7), armor);
      add(arm, 'closed-glove', beveledBox(.3, .24, .3, .045), leather, 0, -.98, .04);
    }
    const swordArm = arms[0], shieldArm = arms[1];
    const weapon = joint(swordArm, hero ? 'longsword' : 'cleaver', 0, -.94, .12);
    weapon.rotation.x = Math.PI * .32;
    add(weapon, 'wrapped-grip', new THREE.CylinderGeometry(.065, .075, .4, 7), leather);
    add(weapon, 'pommel', new THREE.IcosahedronGeometry(.12, 0), trim, 0, -.24, 0);
    add(weapon, 'crossguard', beveledBox(hero ? .66 : .46, .11, .17, .025), trim, 0, .21, 0);
    if (hero) {
      add(weapon, 'diamond-blade', profile([[-.12, .28], [.12, .28], [.11, 1.58], [0, 1.88], [-.11, 1.58]], .09, .02), steel, 0, 0, 0);
      add(weapon, 'blade-fuller', profile([[-.026, .43], [.026, .43], [.022, 1.55], [0, 1.65], [-.022, 1.55]], .012, .004), steelDark, 0, 0, .061);
    } else {
      add(weapon, 'cleaver-blade', profile([[-.12, .25], [.41, .26], [.5, 1.16], [.25, 1.34], [-.12, 1.21]], .12, .025), steel);
    }
    const shield = joint(shieldArm, 'shield', .15, -.66, .26); shield.rotation.y = -.15;
    if (hero) {
      const shieldShape: [number, number][] = [[0, -.83], [.49, -.28], [.47, .52], [0, .72], [-.47, .52], [-.49, -.28]];
      add(shield, 'kite-shield-rim', profile(shieldShape, .17, .035), trim);
      const inset = shieldShape.map(([x, y]) => [x * .85, y * .85] as [number, number]);
      add(shield, 'kite-shield-field', profile(inset, .05, .025), cloth, 0, 0, .13);
      add(shield, 'shield-sun', profile([[0, -.4], [.15, -.02], [0, .36], [-.15, -.02]], .05, .02), trim, 0, 0, .19);
      add(shield, 'shield-boss', new THREE.IcosahedronGeometry(.13, 0), steel, 0, 0, .27);
    } else {
      const buckler = add(shield, 'wood-buckler', new THREE.CylinderGeometry(.43, .43, .15, 8), leather); buckler.rotation.x = Math.PI / 2;
      const rim = add(shield, 'buckler-rim', new THREE.TorusGeometry(.38, .055, 4, 8), trim, 0, 0, .1); rim.rotation.z = .2;
      add(shield, 'buckler-boss', new THREE.IcosahedronGeometry(.16, 0), steel, 0, 0, .16);
    }
    let cape: THREE.Group | undefined;
    if (hero) {
      cape = joint(rig, 'blue-cape', 0, 2.48, -.33);
      add(cape, 'cape-back', profile([[-.46, .03], [.46, .03], [.75, -1.7], [.4, -1.89], [0, -1.76], [-.4, -1.89], [-.75, -1.7]], .055, .015), cloth);
      add(cape, 'cape-fold-left', profile([[-.06, 0], [.04, -.05], [.14, -1.71], [0, -1.8]], .025, .005), clothDark, -.26, -.03, -.047);
      add(cape, 'cape-fold-right', profile([[-.04, -.05], [.06, 0], [0, -1.8], [-.14, -1.71]], .025, .005), clothDark, .26, -.03, -.047);
      cape.rotation.x = .16;
    }
    mergeStatic(root);
    let movement = 0;
    animate = (u, dt, time) => {
      const moving = u.status === 'moving' ? 1 : 0; movement = THREE.MathUtils.damp(movement, moving, 14, dt);
      const gait = time * (hero ? 10.3 : 12.4), stride = Math.sin(gait) * .45 * movement;
      legs[0].rotation.x = stride; legs[1].rotation.x = -stride;
      rig.position.y = Math.abs(Math.sin(gait)) * .055 * movement + Math.sin(time * 2.3) * .018;
      torso.rotation.z = Math.sin(gait) * .035 * movement;
      swordArm.rotation.set(-stride * .5 - .08, 0, -.17); shieldArm.rotation.set(stride * .3 - .08, 0, .12);
      if (u.status === 'windup') {
        const p = 1 - Math.max(0, u.windupLeft) / Math.max(.01, u.windup);
        swordArm.rotation.x = -1.45 * p; swordArm.rotation.z = -.17 - .45 * p;
        torso.rotation.y = -.22 * p; shieldArm.rotation.x = -.35;
      } else if (u.status === 'attacking') {
        const p = Math.min(1, u.actionTime / .25), arc = Math.sin(p * Math.PI);
        swordArm.rotation.x = -.9 + p * 2.05; swordArm.rotation.z = -.55 + p * .72;
        torso.rotation.y = -.22 + arc * .45; rig.position.z = arc * .12;
      } else { torso.rotation.y *= Math.exp(-12 * dt); rig.position.z *= Math.exp(-12 * dt); }
      if (cape) { cape.rotation.x = .14 + movement * .27 + Math.sin(time * 4.1) * .045; cape.rotation.z = Math.sin(gait * .5) * .045; }
      head.rotation.y = Math.sin(time * .7) * .05;
      if (u.status === 'dead') {
        const p = Math.min(1, u.actionTime / .6);
        rig.rotation.z = -p * Math.PI * .48; rig.position.y = -.05;
        rig.position.x = p * .3; legs.forEach(l => { l.rotation.x = .1; });
        swordArm.rotation.x = .5; shieldArm.rotation.x = -.1;
      } else { rig.rotation.z = 0; rig.position.x = 0; }
    };
  }
  root.traverse(child => { child.userData.unitId = unit.id; });
  root.userData.artSource = 'Original procedural stand-in';
  root.userData.forward = '+Z';
  const hitColor = new THREE.Color('#edba9a');
  let deathElapsed = 0;
  return {
    root,
    update(u, dt, time) {
      deathElapsed = u.status === 'dead' ? deathElapsed + dt : 0;
      // Terminal outcomes stop the rules clock, but the fall must finish visually.
      animate(u.status === 'dead' ? { ...u, actionTime: Math.max(u.actionTime, deathElapsed) } : u, dt, time);
      const flash = Math.min(1, Math.max(0, u.hitFlash - deathElapsed) * 6);
      materials.forEach(m => {
        const base = m.userData.originalEmissive as THREE.Color;
        m.emissive.copy(base).lerp(hitColor, flash * .62);
        m.emissiveIntensity = flash > 0 ? .7 : m.userData.originalIntensity as number;
      });
    },
    dispose() { root.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}
