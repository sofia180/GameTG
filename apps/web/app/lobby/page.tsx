"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "../../components/Card";
import Button from "../../components/Button";
import Tag from "../../components/Tag";
import { useSocket } from "../../lib/socket";
import { useAuth } from "../../lib/auth";
import { formatToken } from "../../lib/format";
import { track } from "../../lib/analytics";

const games = [
  { id: "chess", label: "Chess" },
  { id: "checkers", label: "Checkers" },
  { id: "tictactoe", label: "Tic Tac Toe" },
  { id: "battleship", label: "Battleship" },
  { id: "durak", label: "Durak" },
  { id: "mafia", label: "Mafia Mini" },
  { id: "amongus", label: "Among Us Mini" }
] as const;

const categories = [
  { name: "Strategy", hint: "Chess, Durak, Checkers", color: "from-neonPurple/30 via-ink to-neon/20" },
  { name: "Social", hint: "Mafia & Among Us minis", color: "from-amber-400/30 via-ink to-rose-400/20" },
  { name: "Casual", hint: "TicTacToe, Battleship", color: "from-sky-400/25 via-ink to-cyan-300/25" }
];

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
  const [resumeRoom, setResumeRoom] = useState<{ id: string; code: string } | null>(null);
  const [resumeCountdown, setResumeCountdown] = useState<number | null>(null);
  const [flashCup, setFlashCup] = useState<any>(null);
  const [teamQuest, setTeamQuest] = useState<any>(null);
  const [inviteKey, setInviteKey] = useState<any>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "";
  const leaderboard = useMemo(
    () => [
      { user: "RocketFox", earnings: 620, streak: 6 },
      { user: "SilentWolf", earnings: 540, streak: 5 },
      { user: "PixelMage", earnings: 420, streak: 4 },
      { user: "NeonQueen", earnings: 380, streak: 4 }
    ],
    []
  );

  useEffect(() => {
    authFetch<{ rooms: any[] }>("/rooms")
      .then((data) => {
        setRooms(data.rooms);
        setActive(data.rooms.length);
      })
      .catch(() => undefined);
    authFetch<{ tournament: any }>("/flashcup").then((data) => setFlashCup(data.tournament)).catch(() => undefined);
    authFetch<{ quest: any }>("/quests/team").then((data) => setTeamQuest(data.quest)).catch(() => undefined);
    // fetch or create invite key for owner
    authFetch<{ key: any }>("/invites/key", { method: "POST", body: JSON.stringify({ usesLeft: 3, rewardType: "nitro", days: 3 }) })
      .then((data) => setInviteKey(data.key))
      .catch(() => undefined);
    const storedKey = Object.keys(window.localStorage).find((k) => k.startsWith("room:"));
    if (storedKey) {
      const code = window.localStorage.getItem(storedKey);
      if (code) setResumeRoom({ id: storedKey.replace("room:", ""), code });
    }
  }, [authFetch]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setOnline((v) => v + 3);
    const onDisconnect = () => setOnline((v) => Math.max(1, v - 5));
    const onRoomCreated = (payload: { roomId: string; roomCode: string }) => {
      window.localStorage.setItem(`room:${payload.roomId}`, payload.roomCode);
      router.push(`/game/${payload.roomId}?code=${payload.roomCode}`);
    };
    const onMatchFound = (payload: { roomId: string; roomCode: string }) => {
      window.localStorage.setItem(`room:${payload.roomId}`, payload.roomCode);
      router.push(`/game/${payload.roomId}?code=${payload.roomCode}`);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_created", onRoomCreated);
    socket.on("match_found", onMatchFound);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
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
    track("create_room", { gameType, stake: Number(stake), isPrivate });
  };

  const joinRandom = () => {
    socket?.emit("join_random", { gameType, stake: Number(stake) });
    track("join_random", { gameType, stake: Number(stake) });
  };

  const joinRoom = (room: any) => {
    router.push(`/game/${room.id}?code=${room.roomCode}`);
  };
  const resumeLast = () => {
    if (!resumeRoom) return;
    router.push(`/game/${resumeRoom.id}?code=${resumeRoom.code}`);
    track("resume_room", { roomId: resumeRoom.id });
  };

  const claimTeamReward = async () => {
    setClaimLoading(true);
    try {
      await authFetch("/quests/team/claim", { method: "POST" });
      const q = await authFetch<{ quest: any }>("/quests/team");
      setTeamQuest(q.quest);
      track("team_chest_claim");
      alert("Reward claimed!");
    } catch (e: any) {
      alert(e?.message || "Claim failed");
    } finally {
      setClaimLoading(false);
    }
  };

  const inviteLink = inviteKey
    ? botName
      ? `https://t.me/${botName}?start=key_${inviteKey.id}`
      : `${typeof window !== "undefined" ? window.location.origin : ""}/?key=${inviteKey.id}`
    : "";

  const shareInvite = () => {
    if (!inviteKey) return;
    const text = `Присоединяйся в GameTG! Ключ: ${inviteKey.id} ${inviteLink}`;
    if (navigator.share) {
      navigator.share({ title: "Играем?", text, url: inviteLink }).catch(() => undefined);
    } else {
      navigator.clipboard?.writeText(text);
      alert("Скопировано приглашение");
    }
    track("invite_sent", { keyId: inviteKey.id });
  };

  useEffect(() => {
    if (!resumeRoom) return;
    setResumeCountdown(3);
    const interval = setInterval(() => {
      setResumeCountdown((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          clearInterval(interval);
          resumeLast();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resumeRoom]);

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
              <Button variant="primary" onClick={joinRandom}>
                Quick Play
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Invites & Team Quest">
          <div className="space-y-3 text-sm text-slate-300">
            {inviteKey ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-white font-semibold">Invite key</p>
                <p className="text-xs text-slate-200">Uses left: {inviteKey.usesLeft ?? "—"}</p>
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" onClick={shareInvite}>Share</Button>
                  <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(inviteLink)}>Copy link</Button>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Генерируем ключ...</p>
            )}
            {teamQuest && (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
                <p className="text-white font-semibold">Team Chest</p>
                <p className="text-xs text-slate-200">Progress {teamQuest.progress}/{teamQuest.target}</p>
                <div className="mt-2 flex gap-2 items-center">
                  <div className="h-2 w-full rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, (teamQuest.progress / teamQuest.target) * 100)}%` }} />
                  </div>
                  {!teamQuest.rewardClaimed && teamQuest.progress >= teamQuest.target && (
                    <Button size="sm" variant="primary" onClick={claimTeamReward} disabled={claimLoading}>Claim</Button>
                  )}
                  {teamQuest.rewardClaimed && <Tag>Claimed</Tag>}
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card title="Active Rooms">
          <div className="space-y-2 text-sm text-slate-300">
            {resumeRoom && (
              <div className="flex items-center justify-between rounded-lg border border-neon/40 bg-neon/10 p-3">
                <div>
                  <p className="font-semibold text-white">Resume last room</p>
                  <p className="text-xs text-slate-200">{resumeRoom.id}</p>
                  {resumeCountdown !== null && <p className="text-[11px] text-neon">Auto-resume in {resumeCountdown}s</p>}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setResumeCountdown(null)}>Stay</Button>
                  <Button variant="primary" onClick={resumeLast}>Resume</Button>
                </div>
              </div>
            )}
            {teamQuest && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
                <div>
                  <p className="font-semibold text-white">Team Chest</p>
                  <p className="text-xs text-slate-200">
                    Progress {teamQuest.progress}/{teamQuest.target} {teamQuest.rewardClaimed ? "• claimed" : ""}
                  </p>
                </div>
                {!teamQuest.rewardClaimed && teamQuest.progress >= teamQuest.target && (
                  <Button variant="primary" onClick={claimTeamReward} disabled={claimLoading}>
                    Claim
                  </Button>
                )}
              </div>
            )}
            {flashCup && (
              <div className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
                <div>
                  <p className="font-semibold text-white">Flash Cup live</p>
                  <p className="text-xs text-slate-200">Entry {Number(flashCup.entryFee || 0)} • Prize {Number(flashCup.prizePool || 0)}</p>
                </div>
                <Button variant="primary" onClick={() => router.push(`/tournaments/${flashCup.id}`)}>Join</Button>
              </div>
            )}
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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Game Categories">
          <div className="grid gap-3 md:grid-cols-3">
            {categories.map((cat) => (
              <div key={cat.name} className={`rounded-2xl border border-white/10 bg-gradient-to-br ${cat.color} p-4`}>
                <p className="text-xs uppercase tracking-[0.22em] text-white/80">{cat.name}</p>
                <p className="text-sm text-slate-200">{cat.hint}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Live Counters">
          <div className="space-y-3 text-sm text-slate-200">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span>Players online</span>
              <span className="text-neon font-semibold">{online.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span>Active matches</span>
              <span className="text-neon font-semibold">{active}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span>Tournament tab</span>
              <button className="text-neon underline" onClick={() => router.push("/tournaments")}>
                Open tournaments
              </button>
            </div>
          </div>
        </Card>
        <Card title="Leaderboard">
          <div className="space-y-3">
            {leaderboard.map((p, idx) => (
              <div key={p.user} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">#{idx + 1}</span>
                  <span className="text-white font-semibold">{p.user}</span>
                </div>
                <div className="text-right text-xs text-slate-300">
                  <div>+${p.earnings}</div>
                  <div className="text-[11px] text-neon">Streak {p.streak}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
