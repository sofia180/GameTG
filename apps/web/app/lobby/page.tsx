"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "../../components/Card";
import Button from "../../components/Button";
import Tag from "../../components/Tag";
import { useSocket } from "../../lib/socket";
import { useAuth } from "../../lib/auth";
import { formatToken } from "../../lib/format";

const games = [
  { id: "chess", label: "Chess" },
  { id: "checkers", label: "Checkers" },
  { id: "tictactoe", label: "Tic Tac Toe" },
  { id: "battleship", label: "Battleship" },
  { id: "durak", label: "Durak" }
] as const;

export default function LobbyPage() {
  const router = useRouter();
  const socket = useSocket();
  const { authFetch } = useAuth();
  const [gameType, setGameType] = useState<typeof games[number]["id"]>("chess");
  const [stake, setStake] = useState("1");
  const [rooms, setRooms] = useState<any[]>([]);
   const [feed, setFeed] = useState([
    "🔥 Mega Cup filling fast",
    "🧠 Strategy lobby added",
    "⚡ Blitz duel payouts boosted",
    "🌍 Players joining from Poland",
    "🏆 Big win $210 just dropped"
  ]);
  const [online, setOnline] = useState(5321);
  const [active, setActive] = useState(42);

  useEffect(() => {
    authFetch<{ rooms: any[] }>("/rooms")
      .then((data) => setRooms(data.rooms))
      .catch(() => undefined);
  }, [authFetch]);

  useEffect(() => {
    if (!socket) return;
    const onRoomCreated = (payload: { roomId: string; roomCode: string }) => {
      window.localStorage.setItem(`room:${payload.roomId}`, payload.roomCode);
      router.push(`/game/${payload.roomId}?code=${payload.roomCode}`);
    };
    const onMatchFound = (payload: { roomId: string; roomCode: string }) => {
      window.localStorage.setItem(`room:${payload.roomId}`, payload.roomCode);
      router.push(`/game/${payload.roomId}?code=${payload.roomCode}`);
    };
    socket.on("room_created", onRoomCreated);
    socket.on("match_found", onMatchFound);
    return () => {
      socket.off("room_created", onRoomCreated);
      socket.off("match_found", onMatchFound);
    };
  }, [socket, router]);

  // light synthetic motion for lobby energy
  useEffect(() => {
    const interval = setInterval(() => {
      setFeed((prev) => {
        const [first, ...rest] = prev;
        return [...rest, first];
      });
      setOnline((v) => v + Math.floor(Math.random() * 8));
      setActive((v) => Math.max(1, v + Math.floor(Math.random() * 3 - 1)));
    }, 2300);
    return () => clearInterval(interval);
  }, []);

  const feedLoop = useMemo(() => [...feed, ...feed], [feed]);

  const createRoom = (isPrivate: boolean) => {
    socket?.emit("create_room", { gameType, stake: Number(stake), isPrivate });
  };

  const joinRandom = () => {
    socket?.emit("join_random", { gameType, stake: Number(stake) });
  };

  const joinRoom = (room: any) => {
    router.push(`/game/${room.id}?code=${room.roomCode}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-neon">Live Lobby</p>
          <h1 className="text-3xl font-[var(--font-display)] text-white">Instantly jump into a match</h1>
        </div>
        <div className="flex gap-3 text-sm text-slate-300">
          <Tag>{online.toLocaleString()} online</Tag>
          <Tag>{active} active rooms</Tag>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel/70">
        <div className="absolute inset-0 bg-gradient-to-r from-neonPurple/10 via-neon/10 to-neonCyan/10 opacity-60" />
        <div className="relative z-10 flex items-center gap-3 px-4 py-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-neon">Activity</span>
          <div className="ticker relative w-full overflow-hidden">
            <div className="flex min-w-full animate-marquee gap-6 whitespace-nowrap text-sm text-slate-100">
              {feedLoop.map((item, idx) => (
                <span key={`${item}-${idx}`} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-neon shadow-cyan" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card title="Create Match">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {games.map((game) => (
                <button
                  key={game.id}
                  onClick={() => setGameType(game.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    gameType === game.id ? "border-neon text-neon bg-white/5" : "border-white/20 text-slate-300 hover:border-white/40"
                  }`}
                >
                  {game.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="w-32 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
              <Tag>{formatToken(Number(stake || 0))} USDT stake</Tag>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => createRoom(false)}>Create Public</Button>
              <Button variant="ghost" onClick={() => createRoom(true)}>
                Create Private
              </Button>
              <Button variant="ghost" onClick={joinRandom}>
                Join Random
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Active Rooms">
          <div className="space-y-2 text-sm text-slate-300">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 p-3 transition hover:border-neon/60"
              >
                <div>
                  <p className="font-semibold capitalize text-white">{room.gameType}</p>
                  <p className="text-xs text-slate-400">Stake {formatToken(Number(room.stake))} USDT</p>
                </div>
                <Button variant="ghost" onClick={() => joinRoom(room)}>
                  Join
                </Button>
              </div>
            ))}
            {rooms.length === 0 && <p className="text-slate-500">No open rooms yet. Create one!</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
