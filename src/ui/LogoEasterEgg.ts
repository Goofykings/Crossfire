import type {AudioManager} from '../audio/AudioManager';
/** The visible SVG is the button. Effects use its own 64-unit coordinate space. */
export function logoEasterEgg(logo:HTMLElement,audio:AudioManager):void{
 if(logo.querySelector('.logo-trigger'))return;
 const svg=logo.querySelector('svg');if(!svg)return;
 const button=document.createElement('button');button.type='button';button.className='logo-trigger';button.setAttribute('aria-label','Fire the Crossfire logo');svg.replaceWith(button);button.append(svg);
 const effects:SVGElement[]=[];
 // Each authored muzzle face runs from (30,-3) to (30,1): centre (30,-1).
 for(const side of ['left','right'] as const){
  const muzzle=document.createElementNS('http://www.w3.org/2000/svg','g');
  const angle=(side==='left'?-135:-45)*Math.PI/180;
  muzzle.setAttribute('transform',`translate(${32+30*Math.cos(angle)+Math.sin(angle)} ${32+30*Math.sin(angle)-Math.cos(angle)})`);muzzle.setAttribute('aria-hidden','true');
  for(const kind of ['flash','trail']){
   const effect=document.createElementNS('http://www.w3.org/2000/svg','path');effect.setAttribute('class',`logo-${kind} ${side}`);
   effect.setAttribute('d',kind==='flash'?'M0-4 1.2-1.2 4 0 1.2 1.2 0 4-1.2 1.2-4 0-1.2-1.2Z':'M0 0v8');
   muzzle.append(effect);effects.push(effect);
  }
  svg.append(muzzle);
 }
 let last=-Infinity,animations:Animation[]=[];
 button.onclick=()=>{
  const now=performance.now();if(now-last<300)return;last=now;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const animation of animations)animation.cancel();animations=[];
  if(!reduced)animations.push(svg.animate([{transform:'translateY(0)'},{transform:'translateY(.035em) scale(.97)',offset:.2},{transform:'translateY(0)'}],{duration:180,easing:'ease-out'}));
  for(const effect of effects){
   if(reduced&&effect.classList.contains('logo-trail'))continue;
   const dx=effect.classList.contains('left')?-6:6;
   animations.push(effect.animate(effect.classList.contains('logo-trail')?[{opacity:.85,transform:'translate(0,0)'},{opacity:0,transform:`translate(${dx}px,-26px)`}]:[{opacity:1},{opacity:0}],{duration:reduced?90:200,easing:'ease-out'}));
  }
  audio.unlock();audio.playUI('logo');
 };
}
