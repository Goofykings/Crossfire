import {teamMode,modeName} from '../../shared/combat';
import { playerColor, displayTeam, teamOrder } from './teamColors';
import { type PlayerTeam } from '../../shared/combat';
import { pointsOrder, resultOutcome, type RoundResult, type RoundStanding } from '../../shared/scoring';
import { formatScore } from './matchFormatting';
import { weaponIcon } from './WeaponIcons';
import {GEM_ICON} from './ChallengesPanel';

/** Only render a confirmed server receipt; Practice has an explicit no-reward label. */
export function updateResultGems(panel:HTMLElement,result:RoundResult,selfId:string,practice=false):void{
 let reward=panel.querySelector<HTMLElement>('.result-gems');
 const amount=result.gemRewards?.awards[selfId];
 if(!practice&&amount===undefined){reward?.remove();return;}
 if(!reward){reward=document.createElement('div');reward.className='result-gems';reward.setAttribute('role','status');panel.querySelector('.result-banner')!.append(reward);}
 const text=practice?'PRACTICE — NO MATCH GEMS':`+${amount} GEMS EARNED`;if(reward.textContent===text)return;
 reward.replaceChildren();const icon=document.createElement('span');icon.innerHTML=GEM_ICON;reward.append(icon,document.createTextNode(text));reward.dataset.confirmed=String(!practice);reward.classList.toggle('practice',practice);
}

export function resultGroups(result: RoundResult, selfTeam: PlayerTeam = null): { team: PlayerTeam; players: RoundStanding[] }[] {
  const players = [...(result.players ?? [])].sort(pointsOrder);
  return teamMode(result.mode) ? (result.mode==='zone-control'?['blue','red'] as const:teamOrder(selfTeam)).map((team) => ({ team, players: players.filter((p) => p.team === team) }))
    : [{ team: null, players }];
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
}

/** Built once per immutable server result. No polling, animation timers or live-round data. */
export function createRoundResults(result: RoundResult, selfId: string, team: PlayerTeam, next: () => void, home: () => void,practice?:{settings:()=>void}): HTMLElement {
  const shownTeam=(value:PlayerTeam)=>result.mode==='zone-control'?value:displayTeam(value,team);
  const outcome = resultOutcome(result, selfId, team);
  const panel = node('div', 'round-results'); panel.dataset.outcome = outcome.toLowerCase();
  panel.dataset.mode=result.mode;
  const banner = node('header', 'result-banner');
  banner.append(node('small', 'result-mode', practice?'PRACTICE · BOT CHALLENGES COUNT WHEN CONNECTED':`${modeName(result.mode).toUpperCase()} \u00b7 MATCH COMPLETE`), node('h1', 'result-title', outcome));
  const winner = node('p', 'result-winner', result.draw ? 'Match drawn' : teamMode(result.mode)
    ? `${shownTeam(result.winningTeam)?.toUpperCase()} TEAM WINS` : `${result.winner?.name} wins`);
  banner.append(winner); panel.append(banner);
  updateResultGems(panel,result,selfId,!!practice);
  const boards = node('div', 'result-boards'); boards.dataset.mode = result.mode;
  if (!result.players) boards.append(node('p', 'result-unavailable', 'Detailed results unavailable for this earlier round.'));
  else for (const group of resultGroups(result, team)) {
    const section = node('section', 'result-board'); section.dataset.team = shownTeam(group.team) ?? 'ffa';
    const heading = node('h2', 'result-board-heading', group.team ? `${shownTeam(group.team)!.toUpperCase()} TEAM` : 'FINAL RANKING');
    if (group.team && result.teamScores) heading.append(node('strong', 'result-team-score', String(result.teamScores[group.team])));
    section.append(heading);
    const scroll = node('div', 'result-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', `${group.team ?? 'FFA'} match results`);
    const table = node('table'); const head = table.createTHead().insertRow();
    for (const label of ['PLAYER', 'WEAPON', 'SCORE', 'K', 'D', 'A']) { const th = node('th', '', label); th.scope = 'col'; if (label === 'K') th.title = 'Kills'; if (label === 'D') th.title = 'Deaths'; if(label==='A')th.title='Assists'; head.append(th); }
    const body = table.createTBody();
    for (const [i, p] of group.players.entries()) {
      const row = body.insertRow(); row.dataset.playerId = p.id; row.classList.toggle('local', p.id === selfId);
      const friendly = playerColor(result.mode, selfId, team, p.id, p.team) === 'friendly';
      const name = row.insertCell(); name.className = `score-name-${friendly ? 'friendly' : 'opponent'}`;
      name.append(node('span', 'result-rank', String(i + 1)), node('span', 'result-player-name', p.name)); name.title = p.name;
      if (p.id === result.winner?.id) name.append(node('small', 'result-player-winner', 'WINNER'));
      row.insertCell().innerHTML = weaponIcon(p.weapon);
      const score = row.insertCell(); score.textContent = formatScore(p.score); score.title = `${p.score} points`; score.dataset.score = String(p.score);
      for (const value of [p.kills, p.deaths, p.assists??0]) row.insertCell().textContent = String(value);
    }
    scroll.append(table); section.append(scroll);
    if (!group.players.length) section.append(node('p', 'result-empty', 'No participants'));
    boards.append(section);
  }
  panel.append(boards);
  const mvp = node('div', 'result-mvp');
  if (result.mvp) mvp.classList.add(`score-name-${playerColor(result.mode, selfId, team, result.mvp.id, result.players?.find(p => p.id === result.mvp?.id)?.team ?? null)}`);
  if (!result.draw) winner.classList.add(`score-name-${teamMode(result.mode) ? (result.winningTeam === team ? 'friendly' : 'opponent') : playerColor(result.mode, selfId, team, result.winner?.id ?? null, null)}`);
  mvp.append(node('small', '', 'MVP'), node('strong', '', result.mvp?.name ?? 'No participants'), node('span', '', result.mvp ? `${result.mvp.score} points` : ''));
  panel.append(mvp);
  const actions = node('div', 'result-actions');
  const play = node('button', 'btn primary', practice?'RESTART':'PLAY AGAIN'), lobby = node('button', 'btn leave-match', practice?'RETURN HOME':'RETURN TO LOBBY');
  let activated = false;
  const once = (action: () => void) => () => { if (activated) return; activated = true; for(const button of actions.querySelectorAll('button'))button.disabled=true; action(); };
  play.onclick = once(next); lobby.onclick = once(home); actions.append(play, lobby); panel.append(actions);
  if(practice){const settings=node('button','btn','PRACTICE SETTINGS');settings.onclick=once(practice.settings);actions.insertBefore(settings,lobby);}
  return panel;
}
