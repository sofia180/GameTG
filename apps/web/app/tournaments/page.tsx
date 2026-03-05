"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "../../components/Card";
import Button from "../../components/Button";
import Stat from "../../components/Stat";
import Tag from "../../components/Tag";
import { useAuth } from "../../lib/auth";

type Tournament = {
  id: string;
  title: string;
  game: string;
  entryFee: number;
  prizePool: number;
  status: string;
  startsAt?: string;
};

export default function TournamentsPage() {
  const { authFetch, user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [livePrize, setLivePrize] = useState(0);
  const [joined, setJoined] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    authFetch<{ tournaments: Tournament[] }>("/tournaments")
      .then((data) => {
        setTournaments(data.tournaments || []);
        setLivePrize((data.tournaments || []).reduce((sum, t) => sum + Number(t.prizePool || 0), 0));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [authFetch]);

  const duplicated = useMemo(() => [...tournaments, ...tournaments], [tournaments]);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neon">Tournaments</p>
              <h1 className="text-3xl font-[var(--font-display)] text-white">Massive prize pools, live energy</h1>
            </div>
            <div className="flex gap-3 text-sm text-slate-300">
              <Tag>{livePrize.toLocaleString()} USDT live pool</Tag>
              <Tag>{joined} joined today</Tag>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {(tournaments.length ? tournaments : []).map((t) => {
              const progress = 50;
              return (
                <div key={t.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="absolute inset-0 bg-gradient-to-br from-neonPurple/12 via-neon/10 to-neonCyan/12" />
                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-200">
                          {t.game}
                        </span>
                        <p className="text-lg font-[var(--font-display)] text-white">{t.title}</p>
                      </div>
                      <span className="text-neon text-sm">${Number(t.prizePool || 0).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-slate-300">
                      Entry {Number(t.entryFee || 0)} · Status {t.status}
                    </p>
                    <div className="h-2 rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-neonPurple via-neon to-neonCyan"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>Prize Pool</span>
                      <span className="text-white">${Number(t.prizePool || 0)}</span>
                    </div>
                    <Button
                      onClick={async () => {
                        if (!user) return;
                        await authFetch(`/tournaments/${t.id}/join`, { method: "POST" });
                        alert("Joined");
                      }}
                      disabled={loading}
                    >
                      Join Tournament
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Prize Pool Hype">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-neonPurple/25 via-ink to-neonCyan/25 p-6">
            <div className="absolute inset-0 animate-gradient-slow opacity-40" />
            <div className="relative z-10 space-y-3 text-center">
              <p className="text-sm uppercase tracking-[0.26em] text-neon">Live Pool</p>
              <p className="text-4xl font-[var(--font-display)] text-white">${livePrize.toLocaleString()}</p>
              <p className="text-slate-300">Counting up as players join. Boosted by referral and sponsor multipliers.</p>
              <Button>Boost Pool</Button>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Incoming Players</p>
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <div className="flex min-w-full animate-marquee gap-4 whitespace-nowrap px-3 py-2">
                {duplicated.map((t, idx) => (
                  <span key={`${t.id}-${idx}`} className="flex items-center gap-2 text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-neon" />
                    {t.title} +{Math.floor(Math.random() * 3) + 1} joins
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Leaderboard & Rewards">
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Players Today" value="12,480" />
          <Stat label="Payouts Rolling" value="$14,320" />
          <Stat label="Average Match Time" value="54s" />
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-300">Top winners get auto-seeded into premium cups and revenue share tiers.</p>
            <Button variant="ghost" className="mt-3">View Global Leaderboard</Button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-300">Admins can trigger flash tournaments from control panel to spike activity.</p>
            <Button variant="ghost" className="mt-3">Open Admin Panel</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
