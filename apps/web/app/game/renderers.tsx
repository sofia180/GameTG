"use client";

import Button from "../../../components/Button";
import Tag from "../../../components/Tag";

type SendMove = (move: unknown) => void;

export function DurakView({ state, player, sendMove }: { state: any; player: string; sendMove: SendMove }) {
  const isAttacker = state?.attacker === player;
  const myHand = state?.hands?.[player ?? "p1"] ?? [];
  const table = state?.table ?? [];
  const trump = state?.trump;
  const playCard = (card: string) => sendMove({ type: "attack", card });
  const defend = (attackCard: string, defenseCard: string) => sendMove({ type: "defend", attackCard, defenseCard });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">Durak · Trump: {trump} · You are {player}</p>
      <div className="flex flex-wrap gap-2">
        {table.map((p: any, idx: number) => (
          <div key={idx} className="rounded-lg bg-white/5 px-3 py-2">
            <div>Attack: {p.attack}</div>
            <div>Defense: {p.defense ?? "-"}</div>
            {!p.defense && !isAttacker && (
              <div className="flex gap-1 mt-1">
                {myHand.map((c: string) => (
                  <button key={c} className="rounded border border-white/20 px-2 text-xs" onClick={() => defend(p.attack, c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {myHand.map((c: string) => (
          <button
            key={c}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm hover:border-neon"
            onClick={() => (isAttacker ? playCard(c) : undefined)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => sendMove({ type: "take" })}>
          Take
        </Button>
        <Button variant="ghost" onClick={() => sendMove({ type: "end_turn" })}>
          End Turn
        </Button>
      </div>
    </div>
  );
}

export function MafiaView({ state, player, sendMove }: { state: any; player: string; sendMove: SendMove }) {
  const me = state.players?.find((p: any) => p.id === player);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">Mafia · You: {player}</p>
      <p className="text-sm text-white">Role: {me?.role || "hidden"}</p>
      <div className="text-xs text-slate-400">Phase: {state.phase}</div>
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
        Alive: {(state.players || []).filter((p: any) => p.alive).map((p: any) => p.id).join(", ")}
      </div>
      {state.phase === "night" && me?.role === "mafia" && (
        <div className="space-y-2">
          <p className="text-sm text-white">Choose target</p>
          <div className="flex flex-wrap gap-2">
            {(state.players || [])
              .filter((p: any) => p.alive && p.id !== me.id)
              .map((p: any) => (
                <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "mafia_target", target: p.id })}>
                  {p.id}
                </button>
              ))}
          </div>
        </div>
      )}
      {state.phase === "night" && me?.role === "doctor" && (
        <div className="space-y-2">
          <p className="text-sm text-white">Save player</p>
          <div className="flex flex-wrap gap-2">
            {(state.players || []).filter((p: any) => p.alive).map((p: any) => (
              <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "doctor_save", target: p.id })}>
                {p.id}
              </button>
            ))}
          </div>
        </div>
      )}
      {state.phase === "night" && me?.role === "detective" && (
        <div className="space-y-2">
          <p className="text-sm text-white">Check player</p>
          <div className="flex flex-wrap gap-2">
            {(state.players || [])
              .filter((p: any) => p.alive && p.id !== me.id)
              .map((p: any) => (
                <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "detective_check", target: p.id })}>
                  {p.id}
                </button>
              ))}
          </div>
        </div>
      )}
      {state.phase === "day" && (
        <div className="space-y-2">
          <p className="text-sm text-white">Vote to kick</p>
          <div className="flex flex-wrap gap-2">
            {(state.players || [])
              .filter((p: any) => p.alive && p.id !== me?.id)
              .map((p: any) => (
                <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "vote", target: p.id })}>
                  {p.id}
                </button>
              ))}
            <button className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "vote", target: null })}>Skip</button>
          </div>
          <Button variant="ghost" onClick={() => sendMove({ type: "advance_day" })}>Advance day</Button>
        </div>
      )}
      {state.phase === "night" && (
        <Button variant="ghost" onClick={() => sendMove({ type: "advance_night" })}>Advance night</Button>
      )}
    </div>
  );
}

export function AmongUsView({ state, player, sendMove }: { state: any; player: string; sendMove: SendMove }) {
  const me = state.players?.find((p: any) => p.id === player);
  const alive = (state.players || []).filter((p: any) => p.alive);
  const isImpostor = me?.role === "impostor";
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">Among Us Mini · You: {player}</p>
      <p className="text-sm text-white">Role: {me?.role || "hidden"}</p>
      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
        {alive.map((p: any) => (
          <Tag key={p.id}>{p.id}{p.id === player ? " (you)" : ""}</Tag>
        ))}
      </div>
      {isImpostor && (
        <div className="space-y-2">
          <p className="text-sm text-white">Eliminate crewmate</p>
          <div className="flex flex-wrap gap-2">
            {alive.filter((p: any) => p.id !== player && p.role !== "impostor").map((p: any) => (
              <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "kill", target: p.id })}>
                {p.id}
              </button>
            ))}
          </div>
        </div>
      )}
      {!isImpostor && (
        <div className="space-y-2">
          <p className="text-sm text-white">Tasks left: {me?.tasksLeft ?? 0}</p>
          <Button variant="primary" onClick={() => sendMove({ type: "complete_task" })} disabled={(me?.tasksLeft ?? 0) <= 0}>
            Complete Task
          </Button>
        </div>
      )}
      {state.phase === "freeplay" && (
        <Button variant="ghost" onClick={() => sendMove({ type: "report" })}>Report / Call Meeting</Button>
      )}
      {state.phase === "meeting" && (
        <div className="space-y-2">
          <p className="text-sm text-white">Vote</p>
          <div className="flex flex-wrap gap-2">
            {alive.filter((p: any) => p.id !== player).map((p: any) => (
              <button key={p.id} className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "vote", target: p.id })}>
                {p.id}
              </button>
            ))}
            <button className="rounded border border-white/20 px-3 py-1 text-xs" onClick={() => sendMove({ type: "vote", target: null })}>Skip</button>
          </div>
          <Button variant="ghost" onClick={() => sendMove({ type: "end_meeting" })}>End Meeting</Button>
        </div>
      )}
    </div>
  );
}

export function BattleshipView({ state, player, sendMove, randomShips }: { state: any; player: string; sendMove: SendMove; randomShips: () => any[] }) {
  const opponent = player === "p1" ? "p2" : "p1";
  return (
    <div className="space-y-4">
      {state.phase === "placement" && !state.placed?.[player ?? "p1"] && (
        <Button onClick={() => sendMove({ type: "place", ships: randomShips() })}>Auto Place Ships</Button>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs text-slate-400">Your Board</p>
          <div className="grid grid-cols-8 gap-1">
            {state.boards?.[player ?? "p1"]?.map((row: any[], x: number) =>
              row.map((cell: any, y: number) => (
                <div
                  key={`self-${x}-${y}`}
                  className={`h-8 w-8 rounded ${cell.ship ? "bg-neon/40" : "bg-white/10"} ${
                    cell.hit ? "ring-2 ring-ember" : ""
                  }`}
                />
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-400">Enemy Board</p>
          <div className="grid grid-cols-8 gap-1">
            {state.boards?.[opponent]?.map((row: any[], x: number) =>
              row.map((cell: any, y: number) => (
                <button
                  key={`enemy-${x}-${y}`}
                  onClick={() => sendMove({ type: "fire", x, y })}
                  className={`h-8 w-8 rounded ${cell.hit ? "bg-ember/40" : "bg-white/10"}`}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
