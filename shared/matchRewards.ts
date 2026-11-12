/** Shared payout limits; only the authoritative server awards gems. */
export const MATCH_GEM_RULES=Object.freeze({placement:[10,6,3] as readonly number[],pointsPerGem:500,performanceCap:20,winningTeam:2,multiplier:4,minParticipationMs:60000,minDurationMs:600000});
export const MAX_MATCH_GEMS=(MATCH_GEM_RULES.placement[0]+MATCH_GEM_RULES.performanceCap+MATCH_GEM_RULES.winningTeam)*MATCH_GEM_RULES.multiplier;
