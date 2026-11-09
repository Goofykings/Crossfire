import {afterEach,expect,it,vi} from 'vitest';
import {PracticeChallenges} from '../src/practice/PracticeChallenges';
import type {PracticeSimulation} from '../src/practice/PracticeSimulation';
import type {CareerClient} from '../src/network/CareerClient';

afterEach(()=>vi.restoreAllMocks());
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function setup(bots=3){
 const simulation={setup:{bots,difficulty:'intermediate'},actors:[{state:{id:'human',kills:0,lastPlayedTeam:null}}],result:null} as unknown as PracticeSimulation;
 const request=vi.fn().mockResolvedValue('a'.repeat(36));
 const reporter=new PracticeChallenges({practiceChallenge:request} as unknown as CareerClient,simulation);
 return {simulation,request,reporter};
}
it('reports cumulative real kills, throttles requests, and flushes a quit without inventing a win',async()=>{
 let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const {simulation,request,reporter}=setup();await reporter.start();
 expect(request).toHaveBeenLastCalledWith({version:1,action:'start',difficulty:'intermediate',bots:3});
 simulation.actors[0].state.kills=1;reporter.update();await flush();
 expect(request).toHaveBeenLastCalledWith(expect.objectContaining({action:'progress',kills:1,finished:false,won:false}));
 simulation.actors[0].state.kills=2;reporter.update();expect(request).toHaveBeenCalledTimes(2);
 now+=5000;reporter.update();await flush();expect(request).toHaveBeenLastCalledWith(expect.objectContaining({kills:2}));
 simulation.actors[0].state.kills=3;reporter.stop();await flush();
 expect(request).toHaveBeenLastCalledWith(expect.objectContaining({kills:3,finished:false,won:false}));
 reporter.update();expect(request).toHaveBeenCalledTimes(4);
});
it('retries failed cumulative totals, then reports the frozen winner only once',async()=>{
 let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const {simulation,request,reporter}=setup();await reporter.start();
 request.mockRejectedValueOnce(Error('offline'));simulation.actors[0].state.kills=2;
 reporter.update();await flush();now+=5000;reporter.update();await flush();
 expect(request.mock.calls.slice(1).map(([body])=>body.kills)).toEqual([2,2]);
 simulation.result={mode:'ffa',draw:false,winner:{id:'human'}} as PracticeSimulation['result'];
 now+=5000;reporter.update();await flush();
 expect(request).toHaveBeenLastCalledWith(expect.objectContaining({kills:2,finished:true,won:true}));
 now+=5000;reporter.update();reporter.stop();expect(request).toHaveBeenCalledTimes(4);
});
it('keeps zero-bot play offline and excludes kills earned before the account session starts',async()=>{
 const empty=setup(0);await empty.reporter.start();empty.reporter.update();expect(empty.request).not.toHaveBeenCalled();
 const {simulation,request,reporter}=setup();simulation.actors[0].state.kills=4;await reporter.start();
 simulation.actors[0].state.kills=5;reporter.update();await flush();
 expect(request).toHaveBeenLastCalledWith(expect.objectContaining({kills:1}));
});
