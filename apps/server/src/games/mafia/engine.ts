// Minimal server-authoritative Mafia engine (5–10 players). Supports roles, night/day cycle, votes, and win detection.
// This engine is stateful and deterministic; use on server only.

export type MafiaPlayerId = string; // use userId
export type Role = 'mafia' | 'civil' | 'detective' | 'doctor';

export interface MafiaPlayerState {
  id: MafiaPlayerId;
  role: Role;
  alive: boolean;
}

export type Phase = 'night' | 'day' | 'finished';

export interface MafiaState {
  phase: Phase;
  players: MafiaPlayerState[];
  nightActions: {
    mafiaTarget?: MafiaPlayerId;
    doctorSave?: MafiaPlayerId;
    detectiveCheck?: MafiaPlayerId;
  };
  dayVotes: Record<MafiaPlayerId, MafiaPlayerId | null>;
  dayResult?: { kicked?: MafiaPlayerId };
  winner?: 'mafia' | 'town';
  round: number;
}

export type MafiaOutcome =
  | { status: 'win'; side: 'mafia' | 'town'; winners: MafiaPlayerId[] }
  | { status: 'draw' };

export type MafiaMove =
  | { type: 'mafia_target'; target: MafiaPlayerId }
  | { type: 'doctor_save'; target: MafiaPlayerId }
  | { type: 'detective_check'; target: MafiaPlayerId }
  | { type: 'advance_night' }
  | { type: 'vote'; target: MafiaPlayerId | null }
  | { type: 'advance_day' };

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function createMafiaEngine(playerIds: MafiaPlayerId[]) {
  if (playerIds.length < 5 || playerIds.length > 10) throw new Error('Mafia requires 5-10 players');
  const roles: Role[] = [];
  const mafiaCount = playerIds.length >= 8 ? 2 : 1;
  for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
  roles.push('doctor');
  roles.push('detective');
  while (roles.length < playerIds.length) roles.push('civil');
  shuffle(roles);

  const players: MafiaPlayerState[] = playerIds.map((id, idx) => ({ id, role: roles[idx], alive: true }));

  const state: MafiaState = {
    phase: 'night',
    players,
    nightActions: {},
    dayVotes: {},
    round: 1
  };

  const alive = () => state.players.filter((p) => p.alive);
  const aliveOfRole = (role: Role) => alive().filter((p) => p.role === role);

  const winCheck = (): MafiaOutcome | undefined => {
    const mafiaAlive = aliveOfRole('mafia').length;
    const townAlive = alive().length - mafiaAlive;
    if (mafiaAlive === 0) return { status: 'win', side: 'town', winners: alive().map((p) => p.id) };
    if (mafiaAlive >= townAlive) return { status: 'win', side: 'mafia', winners: aliveOfRole('mafia').map((p) => p.id) };
    return undefined;
  };

  const applyMove = (player: MafiaPlayerId, move: MafiaMove) => {
    if (state.phase === 'finished') return { valid: false, error: 'finished', state };
    const me = state.players.find((p) => p.id === player);
    if (!me || !me.alive) return { valid: false, error: 'not alive', state };

    if (move.type === 'mafia_target') {
      if (state.phase !== 'night') return { valid: false, error: 'not night', state };
      if (me.role !== 'mafia') return { valid: false, error: 'not mafia', state };
      state.nightActions.mafiaTarget = move.target;
      return { valid: true, state };
    }

    if (move.type === 'doctor_save') {
      if (state.phase !== 'night') return { valid: false, error: 'not night', state };
      if (me.role !== 'doctor') return { valid: false, error: 'not doctor', state };
      state.nightActions.doctorSave = move.target;
      return { valid: true, state };
    }

    if (move.type === 'detective_check') {
      if (state.phase !== 'night') return { valid: false, error: 'not night', state };
      if (me.role !== 'detective') return { valid: false, error: 'not detective', state };
      state.nightActions.detectiveCheck = move.target;
      return { valid: true, state, detectiveInfo: state.players.find((p) => p.id === move.target)?.role === 'mafia' };
    }

    if (move.type === 'advance_night') {
      if (state.phase !== 'night') return { valid: false, error: 'not night', state };
      // resolve night
      const target = state.players.find((p) => p.id === state.nightActions.mafiaTarget && p.alive);
      const saved = state.nightActions.doctorSave;
      if (target && target.id !== saved) {
        target.alive = false;
      }
      state.dayResult = undefined;
      state.dayVotes = {};
      state.nightActions = {};
      state.phase = 'day';
      const win = winCheck();
      if (win) {
        state.phase = 'finished';
        state.winner = win.side;
        return { valid: true, state, outcome: win };
      }
      return { valid: true, state };
    }

    if (move.type === 'vote') {
      if (state.phase !== 'day') return { valid: false, error: 'not day', state };
      state.dayVotes[player] = move.target;
      return { valid: true, state };
    }

    if (move.type === 'advance_day') {
      if (state.phase !== 'day') return { valid: false, error: 'not day', state };
      // tally votes
      const tally: Record<string, number> = {};
      Object.values(state.dayVotes).forEach((t) => {
        if (!t) return;
        tally[t] = (tally[t] || 0) + 1;
      });
      let kicked: MafiaPlayerId | undefined;
      let max = 0;
      Object.entries(tally).forEach(([pid, count]) => {
        if (count > max) {
          max = count;
          kicked = pid;
        }
      });
      if (kicked) {
        const target = state.players.find((p) => p.id === kicked && p.alive);
        if (target) target.alive = false;
        state.dayResult = { kicked };
      }
      state.phase = 'night';
      state.round += 1;
      const win = winCheck();
      if (win) {
        state.phase = 'finished';
        state.winner = win.side;
        return { valid: true, state, outcome: win };
      }
      return { valid: true, state };
    }

    return { valid: false, error: 'unknown', state };
  };

  return { state, applyMove };
}
