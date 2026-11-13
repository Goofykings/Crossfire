/** Pass server-confirmed designation metadata only. Names are text, never HTML. */
export function username(target:HTMLElement,name:string,developer=false):HTMLElement {
 target.classList.toggle('developer-name',developer);
 if(target.dataset.username===name&&target.dataset.developer===String(developer))return target;
 target.dataset.username=name;target.dataset.developer=String(developer);target.classList.toggle('developer-name',developer);
 target.replaceChildren(document.createTextNode(name));
 if(developer){const badge=document.createElement('span');badge.className='developer-badge';badge.textContent='DEV';badge.setAttribute('aria-label','Developer');target.append(badge);}return target;
}
