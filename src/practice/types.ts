import type {PlayerState,InputFrame} from '../../shared/protocol';
import type {PlayerController} from '../player/PlayerController';
import type {Weapon} from '../weapons/Weapon';
import type {GrenadeCharge} from '../../shared/grenadeCharge';
import type {BotBrain} from './BotBrain';
export interface PracticeActor {
 state:PlayerState&{regenAt:number|null};controller:PlayerController;gun:Weapon|null;
 charge:GrenadeCharge;brain:BotBrain|null;input:InputFrame|null;
}
