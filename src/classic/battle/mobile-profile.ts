import {gameViewport} from '../viewport';
export type MobileQuality='auto'|'smooth'|'high';
export function mobileEnvironment(){
  const query=new URLSearchParams(location.search);
  return matchMedia('(any-pointer: coarse)').matches||gameViewport.width<=900||(query.has('diagnostics')&&query.get('mobile')==='1');
}
export function renderProfile(mobile:boolean,quality:MobileQuality,deviceRatio:number){
  const cap=!mobile?1.5:quality==='smooth'?.85:quality==='high'?1.5:1.1;
  return {pixelRatio:Math.min(deviceRatio,cap),fps:mobile&&quality==='smooth'?30:60};
}
export function loadMobileQuality():MobileQuality {
  try{const value=localStorage.getItem('dota-mobile-quality');if(value==='smooth'||value==='high')return value;}catch{}
  return 'auto';
}
