import type { MapDefinition, MapObstacle } from './types';
export const MAP_SIZE = 96;
export const HALF_MAP = MAP_SIZE / 2;
export const WATER_LEVEL = 0.06;
export function seededRandom(seed: number) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const riverCenter = (x: number) => Math.sin(x * .065) * 3.7;
export const laneCenter = (z: number) => Math.sin(z * .07) * 2.4;
export function smoothstep(a: number, b: number, x: number) { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); }
export function terrainHeight(x: number, z: number): number {
  const d = Math.abs(z-riverCenter(x));
  const ford = 1 - smoothstep(4.5, 8.5, Math.abs(x));
  const bank = smoothstep(4.4, 8.5, d);
  const ground = -.85 + bank * 3.25;
  const crossing = -.12 + smoothstep(1, 11, d)*2.52;
  const rough = (Math.sin(x*.38)*Math.cos(z*.31)*.13 + Math.sin(x*.19+z*.26)*.12) * smoothstep(5, 14, Math.abs(x-laneCenter(z))) * bank;
  return ground*(1-ford)+crossing*ford+rough;
}
export function walkableSurface(x: number, z: number, radius = .62): boolean {
  if (Math.abs(x) > HALF_MAP-2-radius || Math.abs(z) > HALF_MAP-2-radius) return false;
  const riverDistance = Math.abs(z-riverCenter(x));
  return !(riverDistance < 9.2 + radius && Math.abs(x) > 6.8-radius);
}
export function createMap(seed = 683): MapDefinition {
  const rng = seededRandom(seed); const obstacles: MapObstacle[] = [];
  const reserved = [{x:-4,z:21,r:5},{x:3,z:-23,r:5},{x:-1,z:15,r:4},{x:-15,z:17,r:4},{x:17,z:-16,r:4}];
  for (let i=0;i<1700 && obstacles.length<185;i++) {
    const x=(rng()-.5)*87, z=(rng()-.5)*87;
    if (Math.abs(z-riverCenter(x))<11.5 || Math.abs(x-laneCenter(z))<7.8) continue;
    if (reserved.some(p=>Math.hypot(p.x-x,p.z-z)<p.r)) continue;
    if (obstacles.some(p=>Math.hypot(p.x-x,p.z-z)<3.0)) continue;
    const scale=.85+rng()*.65;
    obstacles.push({x,z,kind:'tree',radius:1.05*scale,scale,variant:Math.floor(rng()*3)});
  }
  for(let i=0;i<24;i++) {
    const x=(rng()>.5?1:-1)*(10+rng()*34), z=riverCenter(x)+(rng()>.5?1:-1)*(9.9+rng()*1.8);
    obstacles.push({x,z,kind:'rock',radius:.65+rng()*.45,scale:.7+rng()*.9,variant:Math.floor(rng()*3)});
  }
  obstacles.push({x:-4,z:21,kind:'tower',radius:2.05,scale:1,variant:0},{x:3,z:-23,kind:'tower',radius:2.05,scale:1,variant:1});
  return {size:MAP_SIZE,seed,obstacles};
}
