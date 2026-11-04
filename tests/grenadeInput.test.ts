import { afterEach, expect, it, vi } from 'vitest';
import { Input } from '../src/core/Input';
import { defaultBindings } from '../src/config/keybindings';
afterEach(()=>vi.unstubAllGlobals());
it('requires a fresh configured grenade press after focus/menu cancellation without changing held movement',()=>{
  const events=new EventTarget();vi.stubGlobal('window',events);vi.stubGlobal('document',new EventTarget());
  const input=new Input(new EventTarget() as HTMLCanvasElement);
  try{
    const bindings=defaultBindings();bindings.grenade=['KeyH'];input.setBindings(bindings);input.enabled=true;
    const cancel=vi.fn();input.onClear=cancel;
    const key=(code:string,repeat=false)=>{
      const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{code:{value:code},repeat:{value:repeat}});events.dispatchEvent(event);
    };
    key('KeyH');expect(input.isDown('grenade')).toBe(true);
    events.dispatchEvent(new Event('blur'));expect(cancel).toHaveBeenCalledOnce();expect(input.isDown('grenade')).toBe(false);
    key('KeyH',true);expect(input.isDown('grenade')).toBe(false);
    key('KeyW',true);expect(input.isDown('forward')).toBe(true);
    key('KeyH');expect(input.isDown('grenade')).toBe(true);
    input.clearState();key('KeyH',true);expect(input.isDown('grenade')).toBe(false);
  }finally{input.dispose();}
});
