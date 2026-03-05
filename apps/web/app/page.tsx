"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Card from "../components/Card";
import Button from "../components/Button";
import Stat from "../components/Stat";
import Tag from "../components/Tag";
import { useAuth } from "../lib/auth";

type GameCard = {
  id: string;
  title: string;
  type: "PvP" | "Skill" | "Arcade" | "Strategy" | "Reaction";
  prize: string;
  online: number;
  difficulty: "Easy" | "Medium" | "Hard";
  duration: string;
  tag?: string;
};

const liveFeedBase = [
  "🔥 Alex won $42 in Blitz Duel",
  "💰 Maria earned $18 in Quick Tap",
  "⚡ 90 spots left in Mega Cup",
  "🌍 Player joined from Brazil",
  "🏆 BIG WIN $210 by @cryptofox",
  "🎯 New record in Reaction Rush",
  "🛰️ Team battle lobby filling fast",
  "🧠 Strategy Blitz: 40 online now"
];

const featured: GameCard[] = [
  { id: "blitz", title: "Blitz Duel", type: "PvP", prize: "$250 pool", online: 128, difficulty: "Medium", duration: "60s", tag: "Featured" },
  { id: "reaction", title: "Reaction Rush", type: "Reaction", prize: "$120 pool", online: 96, difficulty: "Easy", duration: "30s" },
  { id: "arcade", title: "Neon Arcade", type: "Arcade", prize: "$90 pool", online: 73, difficulty: "Medium", duration: "45s" },
  { id: "strategy", title: "Mini Strategy", type: "Strategy", prize: "$160 pool", online: 54, difficulty: "Hard", duration: "90s" }
];

const tournaments = [
  { id: "mega", name: "Mega Cup", prize: "$2,500", spots: 90, left: 34, countdown: "18:42" },
  { id: "sprint", name: "Sprint Clash", prize: "$1,200", spots: 64, left: 12, countdown: "09:10" }
];

const leaderboard = [
  { name: "@nova", wins: 34, amount: "$820" },
  { name: "@cypher", wins: 29, amount: "$760" },
  { name: "@orbit", wins: 24, amount: "$640" },
  { name: "@sparx", wins: 21, amount: "$520" },
  { name: "@astra", wins: 18, amount: "$410" }
];

const inviteSteps = [
  { count: 3, reward: "Free tournament entry" },
  { count: 10, reward: "Bonus rewards" },
  { count: 25, reward: "Premium tournaments" },
  { count: 50, reward: "Special badge" },
  { count: 100, reward: "Revenue share level" }
];

const countries = ["Germany", "Poland", "Brazil", "Ukraine", "Turkey", "India", "USA", "Spain"];

export default function LandingPage() {
  const { user, loginTelegram, loginDev } = useAuth();
  const params = useSearchParams();
  const [telegramId, setTelegramId] = useState("");
  const [username, setUsername] = useState("");
  const [liveFeed, setLiveFeed] = useState(liveFeedBase);
  const [metrics, setMetrics] = useState({ players: 12420, winnings: 42180, tournaments: 12, biggest: 680 });

  useEffect(() => {
    const ref = params?.get?.("ref") ?? undefined;
    // @ts-ignore
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    tg?.ready?.();
    const initData = tg?.initData ?? "";
    if (initData) {
      loginTelegram(initData, ref).catch(() => undefined);
    }
  }, [loginTelegram, params]);

  // Light synthetic motion for feed & metrics
  useEffect(() => {
    const feedTimer = setInterval(() => {
      setLiveFeed((prev) => {
        const [first, ...rest] = prev;
        return [...rest, first];
      });
    }, 2500);
    const metricTimer = setInterval(() => {
      setMetrics((m) => ({
        players: m.players + Math.floor(Math.random() * 9),
        winnings: m.winnings + Math.floor(Math.random() * 40),
        tournaments: m.tournaments,
        biggest: Math.max(m.biggest, 680 + Math.floor(Math.random() * 40))
      }));
    }, 1800);
    return () => {
      clearInterval(feedTimer);
      clearInterval(metricTimer);
    };
  }, []);

  const duplicatedFeed = useMemo(() => [...liveFeed, ...liveFeed], [liveFeed]);

  const renderGameCard = (game: GameCard) => (
    <div
      key={game.id}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-panel/80 p-4 shadow-glow transition hover:-translate-y-1 hover:shadow-neon"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-neonPurple/10 to-neonCyan/10 opacity-60" />
      {game.tag && <Tag>{game.tag}</Tag>}
      <div className="relative z-10 mt-2 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-300">{game.type} • {game.duration}</p>
          <p className="text-xl font-[var(--font-display)] text-white">{game.title}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-neon">{game.prize}</span>
      </div>
      <div className="relative z-10 mt-4 flex items-center justify-between text-sm text-slate-300">
        <span>🟢 {game.online} online</span>
        <span>⚡ {game.difficulty}</span>
      </div>
      <div className="relative z-10 mt-4 flex justify-between gap-2">
        <Button>Play</Button>
        <Button variant="ghost">Tournament</Button>
      </div>
      <div className="pointer-events-none absolute -right-16 -top-12 h-32 w-32 rounded-full bg-neon/20 blur-3xl" />
    </div>
  );

  return (
    <div className="relative space-y-10">
      <div className="particle-bg" />
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-panel/60 p-6 shadow-neon md:p-10">
        <div className="blur-glow" />
        <div className="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <p className="text-xs uppercase tracking-[0.32em] text-neon">Global Gaming Hub</p>
            <h1 className="text-4xl font-[var(--font-display)] md:text-5xl">
              Neon-fueled tournaments, instant PvP, and live wins inside Telegram.
            </h1>
            <p className="text-slate-300">
              Tap to play 30–90 second games, climb glowing leaderboards, and watch a world of players win in real time.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/lobby">
                <Button>Play Now</Button>
              </Link>
              <Link href="/tournaments">
                <Button variant="ghost">View Tournaments</Button>
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Players Online" value={metrics.players.toLocaleString()} />
              <Stat label="Winnings Today" value={`$${metrics.winnings.toLocaleString()}`} />
              <Stat label="Active Tournaments" value={metrics.tournaments} />
              <Stat label="Biggest Win" value={`$${metrics.biggest}`} />
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 -z-10 rounded-[28px] bg-gradient-to-br from-neonPurple/30 via-neon/12 to-neonCyan/30 blur-3xl" />
            <Card title="Dev / Telegram Login">
              <form
                className="space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!telegramId) return;
                  await loginDev(telegramId, username || undefined);
                }}
              >
                <label className="text-xs text-slate-400">Telegram ID</label>
                <input
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  value={telegramId}
                  onChange={(e) => setTelegramId(e.target.value)}
                />
                <label className="text-xs text-slate-400">Username</label>
                <input
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <Button type="submit">Enter Demo</Button>
                <p className="text-xs text-slate-400">Or open via Telegram bot to auto-login.</p>
              </form>
            </Card>
          </div>
        </div>
      </section>

      {/* Live ticker */}
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel/70">
        <div className="absolute inset-0 bg-gradient-to-r from-neonPurple/10 via-neon/10 to-neonCyan/10 opacity-60" />
        <div className="relative z-10 flex items-center gap-3 px-4 py-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-neon">Live</span>
          <div className="ticker relative w-full overflow-hidden">
            <div className="flex min-w-full animate-marquee gap-6 whitespace-nowrap text-sm text-slate-100">
              {duplicatedFeed.map((item, idx) => (
                <span key={`${item}-${idx}`} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-neon shadow-cyan" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Game hub */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-[var(--font-display)]">Game Hub</h2>
          <div className="flex gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-white/5 px-3 py-1">Featured</span>
            <span className="rounded-full bg-white/5 px-3 py-1">Trending</span>
            <span className="rounded-full bg-white/5 px-3 py-1">Tournaments</span>
            <span className="rounded-full bg-white/5 px-3 py-1">New</span>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featured.map(renderGameCard)}
        </div>
      </section>

      {/* Tournaments & VS */}
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card title="Tournaments live">
          <div className="grid gap-4 sm:grid-cols-2">
            {tournaments.map((t) => (
              <div key={t.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="absolute inset-0 bg-gradient-to-br from-neonPurple/15 via-neon/10 to-neonCyan/15" />
                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-[var(--font-display)]">{t.name}</p>
                    <span className="text-sm text-neon">{t.prize}</span>
                  </div>
                  <p className="text-sm text-slate-300">{t.spots} spots • {t.left} left</p>
                  <div className="h-2 rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-neonPurple via-neon to-neonCyan"
                      style={{ width: `${((t.spots - t.left) / t.spots) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Countdown</span>
                    <span className="text-white">{t.countdown}</span>
                  </div>
                  <Button>Join Tournament</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Match Start Energy">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-neonPurple/30 via-ink/60 to-neonCyan/30 p-6">
            <div className="absolute inset-0 animate-gradient-slow opacity-40" />
            <div className="relative z-10 flex flex-col items-center gap-4 text-center">
              <p className="text-sm uppercase tracking-[0.28em] text-neon">VS Screen</p>
              <div className="flex items-center gap-4 text-lg font-[var(--font-display)]">
                <div className="rounded-full bg-white/10 px-4 py-2 shadow-neon">@you</div>
                <span className="text-neon">⚡</span>
                <div className="rounded-full bg-white/10 px-4 py-2 shadow-cyan">@rival</div>
              </div>
              <p className="text-4xl font-[var(--font-display)] text-white">3 · 2 · 1</p>
              <p className="text-slate-300">Neon lightning, countdown, energy pulse before every match.</p>
              <Button>Boost Entrance</Button>
            </div>
          </div>
        </Card>
      </section>

      {/* Leaderboard & Invite */}
      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card title="Global Leaderboard">
          <div className="space-y-2">
            {leaderboard.map((row, idx) => (
              <div
                key={row.name}
                className={`flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 ${idx < 3 ? "shadow-neon" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${idx === 0 ? "text-neon" : "text-slate-200"}`}>#{idx + 1}</span>
                  <span className="text-white">{row.name}</span>
                </div>
                <div className="text-sm text-slate-300">{row.wins} wins · {row.amount}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Invite & Earn">
          <div className="space-y-3">
            <p className="text-sm text-slate-300">Share your link, unlock rewards, and climb the creator ladder.</p>
            <div className="space-y-2">
              {inviteSteps.map((step) => (
                <div key={step.count} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between text-sm text-white">
                    <span>Invite {step.count}</span>
                    <span className="text-neon">{step.reward}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-neonPurple via-neon to-neonCyan" style={{ width: `${Math.min(100, (step.count / 100) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <Button>Copy Invite Link</Button>
          </div>
        </Card>
      </section>

      {/* Global activity & economy */}
      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card title="Global Player Activity">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-ink via-panel to-ink p-5">
            <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 30% 30%, rgba(58,211,255,0.18), transparent 45%), radial-gradient(circle at 70% 60%, rgba(154,77,255,0.16), transparent 45%)" }} />
            <div className="relative z-10 space-y-3">
              <p className="text-sm text-slate-300">Live countries joining now</p>
              <div className="grid grid-cols-2 gap-2 text-sm text-white sm:grid-cols-3">
                {countries.map((c) => (
                  <div key={c} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="h-2 w-2 rounded-full bg-neon" />
                    {c}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
        <Card title="Live Economy">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Players Online" value={metrics.players.toLocaleString()} />
            <Stat label="Total Winnings Today" value={`$${metrics.winnings.toLocaleString()}`} />
            <Stat label="Active Tournaments" value={metrics.tournaments} />
            <Stat label="Biggest Win Today" value={`$${metrics.biggest}`} />
          </div>
        </Card>
      </section>
    </div>
  );
}
