import {gameViewport,setGameRotation} from '../../src/classic/viewport';
export type Insets={top:number;right:number;bottom:number;left:number};
export function rotateInsets(s:Insets,turn:boolean):Insets{return turn?{top:s.right,right:s.bottom,bottom:s.left,left:s.top}:s;}
/** Evaluate layout queries against the game stage; device preferences stay native. */
export function layoutQuery(query:string,width:number,height:number,native:(q:string)=>boolean):boolean{
 return query.split(',').some(part=>{
  const replaced=part.replace(/\(\s*(min-|max-)?(width|height)\s*:\s*([\d.]+)px\s*\)/gi,(_,bound,axis,n)=>{
   const v=axis.toLowerCase()==='width'?width:height,limit=Number(n);return (bound==='min-'?v>=limit:bound==='max-'?v<=limit:v===limit)?'(min-width:0px)':'(max-width:-1px)';
  }).replace(/\(\s*orientation\s*:\s*(portrait|landscape)\s*\)/gi,(_,o)=>((o.toLowerCase()==='landscape')===(width>height))?'(min-width:0px)':'(max-width:-1px)');
  return native(replaced);
 });
}
let requested=false,safe:Insets={top:0,right:0,bottom:0,left:0},menuTop=0;
let stage:HTMLElement,button:HTMLButtonElement;
const queries:{rule:CSSMediaRule;query:string}[]=[];
export function resetSafeInsets(){
 const probe=document.createElement('div');probe.style.cssText='position:absolute;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';document.body.append(probe);
 const css=getComputedStyle(probe);safe={top:parseFloat(css.paddingTop)||0,right:parseFloat(css.paddingRight)||0,bottom:parseFloat(css.paddingBottom)||0,left:parseFloat(css.paddingLeft)||0};menuTop=0;probe.remove();applyInsets();
}
export function setSafeInsets(value:Insets,top:number){safe=value;menuTop=top;applyInsets();}
function applyInsets(){
 const root=document.documentElement,insets=rotateInsets(safe,gameViewport.rotated);
 if(gameViewport.rotated)insets.left=Math.max(insets.left,menuTop);
 for(const side of ['top','right','bottom','left']as const)root.style.setProperty('--safe-area-inset-'+side,insets[side]+'px');
 const top=gameViewport.rotated?insets.top:Math.max(menuTop,insets.top);root.style.setProperty('--native-top',top+'px');
 root.classList.toggle('minitool-compact',gameViewport.width>gameViewport.height&&gameViewport.height-top-insets.bottom<320);
 placeQuality();
}
function placeQuality(){
 const quality=stage?.querySelector('.mobile-quality'),parent=stage?.querySelector(document.documentElement.classList.contains('minitool-compact')?'.battle-menu':'.mobile-controls');
 if(quality&&parent&&quality.parentElement!==parent)parent.append(quality);
}
function refresh(){
 const turn=requested&&innerHeight>innerWidth;setGameRotation(turn);
 const root=document.documentElement,w=gameViewport.width,h=gameViewport.height;
 root.style.setProperty('--game-vw',w/100+'px');root.style.setProperty('--game-vh',h/100+'px');root.style.setProperty('--app-height',h+'px');
 stage.style.width=w+'px';stage.style.height=h+'px';stage.style.transform=turn?`translateX(${innerWidth}px) rotate(90deg)`:'none';
 root.classList.toggle('minitool-rotated',turn);
 for(const {rule,query}of queries)rule.media.mediaText=turn?(layoutQuery(query,w,h,q=>matchMedia(q).matches)?'all':'not all'):query;
 button.textContent=turn?'竖屏':'横屏';button.setAttribute('aria-label',turn?'切换竖屏':'切换横屏');button.setAttribute('aria-pressed',String(turn));
 button.hidden=innerWidth>=innerHeight;
 applyInsets();
}
export function installLayout(){
 stage=document.getElementById('minitool-stage')!;
 button=document.createElement('button');button.type='button';button.id='minitool-orientation';
 // This lives in the existing menu so it does not cover the map or controls.
 const addButton=()=>{const menu=stage.querySelector('.battle-menu');if(menu){if(button.parentElement!==menu)menu.append(button);placeQuality();if(stage.querySelector('.mobile-quality'))observer.disconnect();}};
 const observer=new MutationObserver(addButton);observer.observe(stage,{childList:true,subtree:true});addButton();
 function collect(rules:CSSRuleList){for(let i=0;i<rules.length;i++){const rule=rules[i]as CSSMediaRule;if(rule.type===4&&/\b(width|height|orientation)\b/.test(rule.conditionText))queries.push({rule,query:rule.conditionText});if(rule.cssRules)collect(rule.cssRules);}}
 const sheet=(document.getElementById('minitool-styles')as HTMLLinkElement).sheet;if(sheet)collect(sheet.cssRules);
 button.onclick=()=>{requested=!requested;window.dispatchEvent(new Event('resize'));};
 window.addEventListener('resize',refresh);refresh();
}
