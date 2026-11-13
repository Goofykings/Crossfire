import type {AudioManager} from '../audio/AudioManager';
/** One button, four reusable effect nodes, bounded animation/audio; no game callbacks. */
export function logoEasterEgg(logo:HTMLElement,audio:AudioManager):void{
 const svg=logo.querySelector('svg');if(!svg)return;
 const button=document.createElement('button');button.type='button';button.className='logo-trigger';button.setAttribute('aria-label','Fire the Crossfire logo');svg.replaceWith(button);button.append(svg);
 for(const side of ['left','right'])for(const kind of ['flash','trail']){const effect=document.createElement('span');effect.className=`logo-${kind} ${side}`;effect.setAttribute('aria-hidden','true');button.append(effect);}
 let last=-Infinity;
 button.onclick=()=>{
  const now=performance.now();if(now-last<300)return;last=now;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const animation of button.getAnimations({subtree:true}))animation.cancel();
  if(!reduced)svg.animate([{transform:'translateY(0)'},{transform:'translateY(3px) scale(.97)',offset:.2},{transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
  for(const effect of button.querySelectorAll<HTMLElement>('span')){
   if(reduced&&effect.classList.contains('logo-trail'))continue;
   effect.animate(effect.classList.contains('logo-trail')?[{opacity:.7,transform:'translateY(0)'},{opacity:0,transform:'translateY(-30px)'}]:[{opacity:.9},{opacity:0}],{duration:reduced?90:200,easing:'ease-out'});
  }
  audio.unlock();audio.play('rifle_shot',{volume:.1,rate:1.25,jitter:0});
 };
}
