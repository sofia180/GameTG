"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Card from "../../../components/Card";
import Button from "../../../components/Button";
import Tag from "../../../components/Tag";
import { useAuth } from "../../../lib/auth";

export default function TournamentDetail() {
  const { id } = useParams();
  const { authFetch } = useAuth();
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    authFetch<{ tournament: any }>(`/tournaments/${id}`)
      .then((data) => setT(data.tournament))
      .catch(() => setMessage("Failed to load"))
      .finally(() => setLoading(false));
  }, [id, authFetch]);

  const join = async () => {
    if (!id) return;
    setLoading(true);
    try {
      await authFetch(`/tournaments/${id}/join`, { method: "POST" });
      setMessage("Joined tournament");
    } catch (e: any) {
      setMessage(e?.message || "Join failed");
    } finally {
      setLoading(false);
    }
  };

  if (!t) return <p className="text-slate-400">Loading tournament...</p>;

  return (
    <div className="space-y-4">
      <Card title={t.title}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <Tag>{t.game}</Tag>
          <Tag>Status: {t.status}</Tag>
          <Tag>Entry: {Number(t.entryFee || 0)}</Tag>
          <Tag>Prize: {Number(t.prizePool || 0)}</Tag>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={join} disabled={loading}>Join</Button>
          {t.startsAt && <Tag>Starts at {new Date(t.startsAt).toLocaleString()}</Tag>}
        </div>
        {message && <p className="mt-2 text-sm text-amber-200">{message}</p>}
      </Card>
      <Card title="Participants">
        <div className="text-sm text-slate-200 space-y-1">
          {t.participants?.length ? t.participants.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span>{p.userId}</span>
              <span className="text-xs text-slate-400">paid: {String(p.paid)}</span>
            </div>
          )) : <p className="text-slate-400 text-sm">No participants yet.</p>}
        </div>
      </Card>
      <Card title="Matches">
        <div className="text-sm text-slate-200 space-y-1">
          {t.matches?.length ? t.matches.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span>Round {m.round}</span>
              <span>{m.player1Id ?? '-'} vs {m.player2Id ?? '-'}</span>
              <span className="text-xs text-slate-400">winner: {m.winnerId ?? '-'}</span>
            </div>
          )) : <p className="text-slate-400 text-sm">No matches yet.</p>}
        </div>
      </Card>
    </div>
  );
}
