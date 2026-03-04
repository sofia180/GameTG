// Mini Among Us–style social deduction engine (4–10 players).
// Server-authoritative, deterministic state. No client trust.

export type AuPlayerId = string;
export type AuRole = "impostor" | "crewmate";

export type AuPhase = "freeplay" | "meeting" | "finished";

export interface AuPlayerState {
  id: AuPlayerId;
  role: AuRole;
  alive: boolean;
  tasksLeft: number;
}

export interface AuState {
  phase: AuPhase;
  players: AuPlayerState[];
  meeting?: {
    reporter: AuPlayerId;
    votes: Record<AuPlayerId, AuPlayerId | null>;
    topic?: AuPlayerId;
    round: number;
  };
  winner?: "crew" | "impostor";
}

export type AuOutcome =
  | { status: "win"; side: "crew" | "impostor"; winners: AuPlayerId[] }
  | { status: "draw" };

export type AuMove =
  | { type: "complete_task" }
  | { type: "kill"; target: AuPlayerId }
  | { type: "report"; target?: AuPlayerId }
  | { type: "vote"; target: AuPlayerId | null }
  | { type: "end_meeting" };

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function createAmongUsEngine(playerIds: AuPlayerId[]) {
  if (playerIds.length < 4 || playerIds.length > 10) throw new Error("AmongUs-lite requires 4-10 players");

  // role distribution: 1 impostor up to 7 players, 2 otherwise
  const impostorCount = playerIds.length >= 8 ? 2 : 1;
  const roles: AuRole[] = Array.from({ length: impostorCount }, () => "impostor");
  while (roles.length < playerIds.length) roles.push("crewmate");
  shuffle(roles);

  const tasksPerCrew = 3;
  const players: AuPlayerState[] = playerIds.map((id, idx) => ({
    id,
    role: roles[idx],
    alive: true,
    tasksLeft: roles[idx] === "crewmate" ? tasksPerCrew : 0
  }));

  const state: AuState = {
    phase: "freeplay",
    players
  };

  const alive = () => state.players.filter((p) => p.alive);
  const aliveByRole = (role: AuRole) => alive().filter((p) => p.role === role);

  const tasksRemaining = () => state.players.filter((p) => p.role === "crewmate").reduce((sum, p) => sum + p.tasksLeft, 0);

  const winCheck = (): AuOutcome | undefined => {
    const impostorsAlive = aliveByRole("impostor").length;
    const crewAlive = alive().length - impostorsAlive;
    if (impostorsAlive === 0) return { status: "win", side: "crew", winners: alive().map((p) => p.id) };
    if (impostorsAlive >= crewAlive) return { status: "win", side: "impostor", winners: aliveByRole("impostor").map((p) => p.id) };
    if (tasksRemaining() === 0) return { status: "win", side: "crew", winners: state.players.filter((p) => p.role === "crewmate").map((p) => p.id) };
    return undefined;
  };

  const applyMove = (player: AuPlayerId, move: AuMove) => {
    if (state.phase === "finished") return { valid: false, error: "finished", state };
    const me = state.players.find((p) => p.id === player);
    if (!me || !me.alive) return { valid: false, error: "not alive", state };

    if (move.type === "complete_task") {
      if (state.phase !== "freeplay") return { valid: false, error: "meeting active", state };
      if (me.role !== "crewmate") return { valid: false, error: "not crewmate", state };
      if (me.tasksLeft <= 0) return { valid: false, error: "no tasks", state };
      me.tasksLeft -= 1;
      const win = winCheck();
      if (win) {
        state.phase = "finished";
        state.winner = win.side === "crew" ? "crew" : "impostor";
        return { valid: true, state, outcome: win };
      }
      return { valid: true, state };
    }

    if (move.type === "kill") {
      if (state.phase !== "freeplay") return { valid: false, error: "meeting active", state };
      if (me.role !== "impostor") return { valid: false, error: "not impostor", state };
      if (player === move.target) return { valid: false, error: "self kill", state };
      const target = state.players.find((p) => p.id === move.target && p.alive);
      if (!target) return { valid: false, error: "invalid target", state };
      if (target.role === "impostor") return { valid: false, error: "cannot kill impostor", state };
      target.alive = false;
      const win = winCheck();
      if (win) {
        state.phase = "finished";
        state.winner = win.side === "crew" ? "crew" : "impostor";
        return { valid: true, state, outcome: win };
      }
      return { valid: true, state };
    }

    if (move.type === "report") {
      if (state.phase !== "freeplay") return { valid: false, error: "meeting active", state };
      state.phase = "meeting";
      state.meeting = { reporter: player, votes: {}, topic: move.target, round: (state.meeting?.round ?? 0) + 1 };
      return { valid: true, state };
    }

    if (move.type === "vote") {
      if (state.phase !== "meeting" || !state.meeting) return { valid: false, error: "no meeting", state };
      if (!me.alive) return { valid: false, error: "not alive", state };
      state.meeting.votes[player] = move.target;
      return { valid: true, state };
    }

    if (move.type === "end_meeting") {
      if (state.phase !== "meeting" || !state.meeting) return { valid: false, error: "no meeting", state };
      // tally
      const tally: Record<string, number> = {};
      Object.values(state.meeting.votes).forEach((t) => {
        if (!t) return;
        tally[t] = (tally[t] || 0) + 1;
      });
      let kicked: AuPlayerId | undefined;
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
      }
      state.meeting = undefined;
      state.phase = "freeplay";
      const win = winCheck();
      if (win) {
        state.phase = "finished";
        state.winner = win.side === "crew" ? "crew" : "impostor";
        return { valid: true, state, outcome: win };
      }
      return { valid: true, state };
    }

    return { valid: false, error: "unknown", state };
  };

  return { state, applyMove };
}
