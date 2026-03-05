"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Card from "../../../components/Card";
import Button from "../../../components/Button";
import Tag from "../../../components/Tag";
import { useSocket } from "../../../lib/socket";
import { track } from "../../../lib/analytics";
import dynamic from "next/dynamic";

type Player = "p1" | "p2" | string;
const DurakView = dynamic(() => import("../renderers").then((m) => m.DurakView), { ssr: false, loading: () => <p className="text-slate-400">Loading Durak…</p> });
const MafiaView = dynamic(() => import("../renderers").then((m) => m.MafiaView), { ssr: false, loading: () => <p className="text-slate-400">Loading Mafia…</p> });
const AmongUsView = dynamic(() => import("../renderers").then((m) => m.AmongUsView), { ssr: false, loading: () => <p className="text-slate-400">Loading game…</p> });
const BattleshipView = dynamic(() => import("../renderers").then((m) => m.BattleshipView), { ssr: false, loading: () => <p className="text-slate-400">Loading battleship…</p> });

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
  if (!params?.id) {
    return <p className="text-slate-400">Invalid room</p>;
  }
  const search = useSearchParams();
  const router = useRouter();
  const socket = useSocket();
  const roomId = params.id as string;
  const [roomCode, setRoomCode] = useState<string | undefined>(undefined);

  const [gameType, setGameType] = useState<string>("");
  const [state, setState] = useState<any>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [message, setMessage] = useState<string>("");
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const [chessFrom, setChessFrom] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(true);
  const [ended, setEnded] = useState<{ reason?: string; winners?: string[] } | null>(null);

  useEffect(() => {
    const fromQuery = search?.get?.("code");
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
    const join = () => socket.emit("join_room", { roomId, roomCode });
    const onConnect = () => {
      setConnected(true);
      join();
    };
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    join();
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
      setEnded({ reason: payload.reason, winners: payload.winners });
      track("game_end", { roomId, reason: payload.reason, winners: payload.winners, gameType });
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
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, roomId, roomCode]);

  const shareLink = () => {
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "";
    const code = roomCode || roomId;
    const deeplink = bot ? `https://t.me/${bot}?start=room_${code}` : `${window.location.origin}/game/${roomId}?code=${code}`;
    const text = `Сыграем реванш в ${gameType || "game"}? ${deeplink}`;
    if (navigator.share) {
      navigator.share({ title: "Реванш", text, url: deeplink }).catch(() => undefined);
    } else {
      navigator.clipboard?.writeText(text);
      alert("Ссылка скопирована");
    }
    track("share_replay", { roomId, gameType, deeplink });
  };

  const rematch = () => {
    track("rematch_clicked", { roomId, gameType });
    router.push("/lobby");
  };

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
      return <BattleshipView state={state} player={player ?? "p1"} sendMove={sendMove} randomShips={randomBattleshipShips} />;
    }

    if (gameType === "durak") {
      return <DurakView state={state} player={player ?? "p1"} sendMove={sendMove} />;
    }

    if (gameType === "mafia") {
      return <MafiaView state={state} player={player ?? ""} sendMove={sendMove} />;
    }

    if (gameType === "amongus") {
      return <AmongUsView state={state} player={player ?? ""} sendMove={sendMove} />;
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
            {!connected && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-100">Reconnecting…</p>}
            <p>Invite code: {roomCode ?? "--"}</p>
            <p>{message || "Waiting for opponent or next move."}</p>
            {ended && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm text-white">Реванш или поделиться результатом</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={rematch}>Реванш</Button>
                  <Button variant="ghost" onClick={shareLink}>Поделиться</Button>
                </div>
                {ended?.reason && <p className="text-xs text-slate-400">Причина: {ended.reason}</p>}
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }
