"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Card from "../../../components/Card";
import Button from "../../../components/Button";
import Tag from "../../../components/Tag";
import { useSocket } from "../../../lib/socket";

type Player = "p1" | "p2";

function fenToBoard(fen: string) {
  const [board] = fen.split(" ");
  const rows = board.split("/");
  return rows.map((row) => {
    const cells: string[] = [];
    for (const char of row) {
      if (Number.isNaN(Number(char))) {
        cells.push(char);
      } else {
        const count = Number(char);
        for (let i = 0; i < count; i += 1) cells.push("");
      }
    }
    return cells;
  });
}

function randomBattleshipShips() {
  const ships = [3, 3, 2];
  const size = 8;
  const placements: { x: number; y: number; length: number; orientation: "h" | "v" }[] = [];
  const board = Array.from({ length: size }, () => Array(size).fill(false));

  for (const length of ships) {
    let placed = false;
    while (!placed) {
      const orientation = Math.random() > 0.5 ? "h" : "v";
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      let valid = true;
      for (let i = 0; i < length; i += 1) {
        const nx = orientation === "h" ? x + i : x;
        const ny = orientation === "v" ? y + i : y;
        if (nx >= size || ny >= size || board[nx][ny]) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      for (let i = 0; i < length; i += 1) {
        const nx = orientation === "h" ? x + i : x;
        const ny = orientation === "v" ? y + i : y;
        board[nx][ny] = true;
      }
      placements.push({ x, y, length, orientation });
      placed = true;
    }
  }
  return placements;
}

export default function GameRoomPage() {
  const params = useParams();
  const search = useSearchParams();
  const socket = useSocket();
  const roomId = params.id as string;
  const [roomCode, setRoomCode] = useState<string | undefined>(undefined);

  const [gameType, setGameType] = useState<string>("");
  const [state, setState] = useState<any>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [message, setMessage] = useState<string>("");
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const [chessFrom, setChessFrom] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = search.get("code");
    if (fromQuery) {
      setRoomCode(fromQuery);
      window.localStorage.setItem(`room:${roomId}`, fromQuery);
      return;
    }
    const stored = window.localStorage.getItem(`room:${roomId}`) ?? undefined;
    if (stored) setRoomCode(stored);
  }, [search, roomId]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("join_room", { roomId, roomCode });
    const onStart = (payload: any) => {
      if (payload.roomId !== roomId) return;
      setGameType(payload.gameType);
      setState(payload.state);
      setPlayer(payload.player as Player);
    };
    const onMove = (payload: any) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      setState(payload.state);
    };
    const onEnd = (payload: any) => {
      setMessage(`Game ended: ${payload.reason}`);
    };
    const onError = (payload: any) => {
      setMessage(payload.message ?? "Error");
    };
    socket.on("start_game", onStart);
    socket.on("move", onMove);
    socket.on("game_end", onEnd);
    socket.on("error", onError);
    return () => {
      socket.off("start_game", onStart);
      socket.off("move", onMove);
      socket.off("game_end", onEnd);
      socket.off("error", onError);
    };
  }, [socket, roomId, roomCode]);

  const sendMove = (move: unknown) => {
    socket?.emit("move", { roomId, move });
  };

  const chessBoard = useMemo(() => {
    if (!state?.fen) return [];
    return fenToBoard(state.fen);
  }, [state]);

  const renderBoard = () => {
    if (!state) return <p className="text-slate-400">Waiting for opponent...</p>;

    if (gameType === "tictactoe") {
      return (
        <div className="grid w-48 grid-cols-3 gap-2">
          {state.board.map((row: any[], x: number) =>
            row.map((cell: string | null, y: number) => (
              <button
                key={`${x}-${y}`}
                onClick={() => sendMove({ x, y })}
                className="aspect-square rounded-lg border border-white/10 text-xl"
              >
                {cell === "p1" ? "X" : cell === "p2" ? "O" : ""}
              </button>
            ))
          )}
        </div>
      );
    }

    if (gameType === "durak") {
      const isAttacker = state?.attacker === player;
      const myHand = state?.hands?.[player === "p1" ? "p1" : "p2"] ?? [];
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
                {isAttacker && !p.defense && (
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

    if (gameType === "checkers") {
      return (
        <div className="grid grid-cols-8 gap-1">
          {state.board.map((row: any[], x: number) =>
            row.map((cell: string | null, y: number) => {
              const selected = selection?.x === x && selection?.y === y;
              return (
                <button
                  key={`${x}-${y}`}
                  onClick={() => {
                    if (!selection) {
                      setSelection({ x, y });
                    } else {
                      sendMove({ from: selection, to: { x, y } });
                      setSelection(null);
                    }
                  }}
                  className={`h-10 w-10 rounded ${selected ? "bg-neon/40" : "bg-white/5"}`}
                >
                  {cell === "p1" ? "●" : cell === "p2" ? "○" : ""}
                </button>
              );
            })
          )}
        </div>
      );
    }

    if (gameType === "chess") {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-8 gap-1">
            {chessBoard.map((row, r) =>
              row.map((cell, c) => {
                const file = String.fromCharCode(97 + c);
                const rank = 8 - r;
                const square = `${file}${rank}`;
                const selected = chessFrom === square;
                return (
                  <button
                    key={square}
                    onClick={() => {
                      if (!chessFrom) {
                        setChessFrom(square);
                      } else {
                        sendMove({ from: chessFrom, to: square });
                        setChessFrom(null);
                      }
                    }}
                    className={`h-10 w-10 rounded ${selected ? "bg-neon/40" : "bg-white/5"}`}
                  >
                    {cell}
                  </button>
                );
              })
            )}
          </div>
          <p className="text-xs text-slate-400">Tap from-square then to-square.</p>
        </div>
      );
    }

    if (gameType === "battleship") {
      const opponent = player === "p1" ? "p2" : "p1";
      return (
        <div className="space-y-4">
          {state.phase === "placement" && !state.placed?.[player ?? "p1"] && (
            <Button onClick={() => sendMove({ type: "place", ships: randomBattleshipShips() })}>Auto Place Ships</Button>
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

    if (gameType === "durak") {
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

    if (gameType === "mafia") {
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

    return <p className="text-slate-400">Unsupported game type.</p>;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card title="Game Room">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <Tag>Room {roomId.slice(0, 6)}</Tag>
          {gameType && <Tag>{gameType}</Tag>}
          {player && <Tag>You: {player}</Tag>}
        </div>
        <div className="mt-4">{renderBoard()}</div>
      </Card>
      <Card title="Match Info">
        <div className="space-y-3 text-sm text-slate-300">
          <p>Invite code: {code ?? "--"}</p>
          <p>{message || "Waiting for opponent or next move."}</p>
        </div>
      </Card>
    </div>
  );
}
