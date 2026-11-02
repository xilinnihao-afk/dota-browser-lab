import * as THREE from 'three';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import { decodeBLP, getBLPImageData, parseMDX, type model } from 'war3-model';

let root = `${import.meta.env?.BASE_URL ?? '/'}assets/original/`;
export function setAssetRoot(relative: string) { root = `${import.meta.env?.BASE_URL ?? '/'}${relative}`; }
const textures = new Map<string, Promise<THREE.DataTexture>>();
const models = new Map<string, Promise<model.Model>>();
export const paths = {
  hero: 'units/orc/heroblademaster/heroblademaster.mdx',
  footman: 'units/human/footman/footman.mdx',
  ghoul: 'units/undead/ghoul/ghoul.mdx',
  tower: 'buildings/nightelf/ancientprotector/ancientprotector.mdx',
  trees: [0, 1, 2].map(i => `doodads/terrain/lordaerontree/lordaerontree${i}.mdx`),
  grass: 'terrainart/lordaeronsummer/lords_grass.blp',
  dirt: 'terrainart/lordaeronsummer/lords_dirt.blp',
  tree: 'replaceabletextures/lordaerontree/lordaeronsummertree.blp',
  portrait: 'replaceabletextures/commandbuttons/btnheroblademaster.blp',
  selection: 'replaceabletextures/selection/selectioncirclelarge.blp',
  shadow: 'replaceabletextures/shadows/shadow.blp',
};

export function normalizeAssetPath(path: string) {
  const result = path.replaceAll('\\', '/').toLowerCase();
  if (result.startsWith('/') || result.split('/').some(p => p === '..') || result.includes(':')) throw new Error(`不安全的资源路径：${path}`);
  return result;
}

async function binary(path: string, signature?: string) {
  const response = await fetch(root + normalizeAssetPath(path));
  if (!response.ok) throw new Error(`缺少原版资源：${path}（${response.status}）`);
  const data = await response.arrayBuffer();
  if (signature && String.fromCharCode(...new Uint8Array(data, 0, Math.min(4, data.byteLength))) !== signature) {
    throw new Error(`资源格式错误：${path}；请准备原始 ${signature} 文件`);
  }
  return data;
}

export function loadModel(path: string): Promise<model.Model> {
  path = normalizeAssetPath(path);
  if (!models.has(path)) models.set(path, binary(path, 'MDLX').then(data => {
    const result = parseMDX(data);
    if (result.Version !== 800) throw new Error(`${path} 不是已支持的经典版 MDX 800`);
    return result;
  }));
  return models.get(path)!;
}

export function loadTexture(path: string, flags = 0): Promise<THREE.DataTexture> {
  path = normalizeAssetPath(path);
  const key = `${path}:${flags}`;
  if (!textures.has(key)) textures.set(key, binary(path, path.endsWith('.tga')?undefined:'BLP1').then(data => {
    // @types/three declares parse as DataTexture, but r180 returns TexData.
    const pixels=path.endsWith('.tga')?new TGALoader().parse(data) as unknown as {data:Uint8Array;width:number;height:number}:getBLPImageData(decodeBLP(data),0);
    const texture = new THREE.DataTexture(new Uint8Array(pixels.data as Uint8Array), pixels.width, pixels.height);
    texture.name = path;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // Original MDX UVs and BLP row order share the same origin.
    texture.wrapS = flags & 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = flags & 2 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }));
  return textures.get(key)!;
}

export async function modelTextures(source: model.Model, team: number, replacements: Record<number,string> = {}) {
  return Promise.all(source.Textures.map(texture => {
    if (texture.Image) return loadTexture(texture.Image, texture.Flags);
    if (replacements[texture.ReplaceableId ?? 0]) return loadTexture(replacements[texture.ReplaceableId ?? 0], texture.Flags);
    const id = String(team).padStart(2, '0');
    if (texture.ReplaceableId === 1) return loadTexture(`replaceabletextures/teamcolor/teamcolor${id}.blp`);
    if (texture.ReplaceableId === 2) return loadTexture(`replaceabletextures/teamglow/teamglow${id}.blp`);
    if (texture.ReplaceableId === 31) return loadTexture(paths.tree);
    const trees:Record<number,string>={32:'ashenvaletree/ashentree',33:'barrenstree/barrenstree',34:'northrendtree/northtree',35:'outlandmushrooms/mushroomtree',36:'ruinstree/ruinstree',37:'undergroundtree/undergroundtree'};
    if(trees[texture.ReplaceableId ?? 0])return loadTexture(`replaceabletextures/${trees[texture.ReplaceableId ?? 0]}.blp`,texture.Flags);
    throw new Error(`尚未映射 ReplaceableId=${texture.ReplaceableId}`);
  }));
}

export function textureDataUrl(texture: THREE.DataTexture) {
  const {width, height, data} = texture.image;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data as Uint8Array), width, height), 0, 0);
  return canvas.toDataURL();
}

export async function disposeAssets() {
  for (const promise of textures.values()) { try { (await promise).dispose(); } catch { /* rejected load has no GPU resource */ } }
  textures.clear(); models.clear();
}
