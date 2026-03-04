"use client";

import { useEffect, useState } from "react";
import Card from "../../components/Card";
import Button from "../../components/Button";
import { API_URL } from "../../lib/api";

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [newT, setNewT] = useState({ title: "", game: "dota", entryFee: "1", prizePool: "" });
  const [report, setReport] = useState({ tournamentId: "", matchId: "", winnerId: "" });
  const [txFilter, setTxFilter] = useState<{ type: string; status: string }>({ type: "", status: "" });
  const [metrics, setMetrics] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [movesGameId, setMovesGameId] = useState("");
  const [reviewDeposits, setReviewDeposits] = useState<any[]>([]);
  const [reviewWins, setReviewWins] = useState<any[]>([]);
  const [riskReport, setRiskReport] = useState<any>(null);

  const load = async () => {
    if (!key) return;
    const res = await fetch(`${API_URL}/admin/overview`, { headers: { "x-admin-key": key } });
    const overviewData = await res.json();
    setOverview(overviewData);
    const usersRes = await fetch(`${API_URL}/admin/users`, { headers: { "x-admin-key": key } });
    const usersData = await usersRes.json();
    setUsers(usersData.users ?? []);
    const wdRes = await fetch(`${API_URL}/admin/withdrawals`, { headers: { "x-admin-key": key } });
    const wdData = await wdRes.json();
    setWithdrawals(wdData.withdrawals ?? []);
    const txRes = await fetch(`${API_URL}/admin/transactions`, { headers: { "x-admin-key": key } });
    const txData = await txRes.json();
    setTransactions(txData.transactions ?? []);
    const tRes = await fetch(`${API_URL}/tournaments`, { headers: { "x-admin-key": key } });
    const tData = await tRes.json();
    setTournaments(tData.tournaments ?? []);
    const mRes = await fetch(`${API_URL}/admin/metrics`, { headers: { "x-admin-key": key } });
    const mData = await mRes.json();
    setMetrics(mData);
    const revRes = await fetch(`${API_URL}/admin/deposits/review`, { headers: { "x-admin-key": key } });
    const revData = await revRes.json();
    setReviewDeposits(revData.review ?? []);
    const rwRes = await fetch(`${API_URL}/admin/wins/review`, { headers: { "x-admin-key": key } });
    const rwData = await rwRes.json();
    setReviewWins(rwData.review ?? []);
    const riskRes = await fetch(`${API_URL}/admin/risk/report`, { headers: { "x-admin-key": key } });
    const riskData = await riskRes.json();
    setRiskReport(riskData);
  };

  useEffect(() => {
    const stored = window.localStorage.getItem("admin_key");
    if (stored) setKey(stored);
  }, []);

  return (
    <div className="grid gap-6">
      <Card title="Admin Access">
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            placeholder="Admin API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            onClick={() => {
              window.localStorage.setItem("admin_key", key);
              load();
            }}
          >
            Load
          </Button>
        </div>
      </Card>
      <Card title="Metrics">
        {metrics ? (
          <pre className="whitespace-pre-wrap text-xs text-slate-200">{JSON.stringify(metrics, null, 2)}</pre>
        ) : (
          <p className="text-sm text-slate-400">Press Load to fetch metrics.</p>
        )}
      </Card>
      <Card title="Risk / Anti-fraud">
        {riskReport ? (
          <div className="space-y-2 text-xs text-slate-200">
            <div>Deposits in review: {riskReport.reviewDeposits}</div>
            <div>Wins in review: {riskReport.reviewWins}</div>
            <div>Withdraws pending/review: {riskReport.reviewWithdraws}</div>
            <div>Short games (moves &lt; 2, last hour): {riskReport.shortGames}</div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-[11px] text-slate-400">Repeat pairs (&gt;3 matches/hour)</p>
              {riskReport.repeatPairs?.length
                ? riskReport.repeatPairs.map((p: any, idx: number) => (
                    <div key={idx} className="flex justify-between">
                      <span>{p.player1Id} vs {p.player2Id}</span>
                      <span>x{p._count._all}</span>
                    </div>
                  ))
                : <p className="text-slate-500">None</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Press Load to fetch risk report.</p>
        )}
      </Card>
      {overview && (
        <Card title="Overview">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>Total users: {overview.totalUsers}</div>
            <div>Total games: {overview.totalGames}</div>
            <div>Total volume: {overview.totalVolume}</div>
            <div>Total fees: {overview.totalFees}</div>
          </div>
        </Card>
      )}
      <Card title="Users">
        <div className="space-y-2 text-xs text-slate-300">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between">
              <span>{user.username ?? user.telegramId}</span>
              <span>{user.isBanned ? "banned" : "active"}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Tournaments">
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4">
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Title"
              value={newT.title}
              onChange={(e) => setNewT((s) => ({ ...s, title: e.target.value }))}
            />
            <select
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={newT.game}
              onChange={(e) => setNewT((s) => ({ ...s, game: e.target.value }))}
            >
              <option value="dota">Dota</option>
              <option value="cs">Counter-Strike</option>
              <option value="wot">World of Tanks</option>
            </select>
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Entry fee"
              value={newT.entryFee}
              onChange={(e) => setNewT((s) => ({ ...s, entryFee: e.target.value }))}
            />
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Prize pool (optional)"
              value={newT.prizePool}
              onChange={(e) => setNewT((s) => ({ ...s, prizePool: e.target.value }))}
            />
          </div>
          <Button
            onClick={async () => {
              await fetch(`${API_URL}/tournaments`, {
                method: "POST",
                headers: { "x-admin-key": key, "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: newT.title,
                  game: newT.game,
                  entryFee: Number(newT.entryFee || 0),
                  prizePool: newT.prizePool ? Number(newT.prizePool) : undefined
                })
              });
              load();
            }}
            disabled={!newT.title}
          >
            Create tournament
          </Button>
          <div className="space-y-2 text-xs text-slate-300">
            {tournaments.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span>{t.title} · {t.game} · entry {Number(t.entryFee || 0)}</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await fetch(`${API_URL}/tournaments/${t.id}/start`, { method: "POST", headers: { "x-admin-key": key } });
                      load();
                    }}
                  >
                    Seed bracket
                  </Button>
                </div>
              </div>
            ))}
            {!tournaments.length && <p className="text-slate-500">No tournaments yet.</p>}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Tournament ID"
              value={report.tournamentId}
              onChange={(e) => setReport((s) => ({ ...s, tournamentId: e.target.value }))}
            />
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Match ID"
              value={report.matchId}
              onChange={(e) => setReport((s) => ({ ...s, matchId: e.target.value }))}
            />
            <input
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              placeholder="Winner userId"
              value={report.winnerId}
              onChange={(e) => setReport((s) => ({ ...s, winnerId: e.target.value }))}
            />
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              await fetch(`${API_URL}/tournaments/${report.tournamentId}/report`, {
                method: "POST",
                headers: { "x-admin-key": key, "Content-Type": "application/json" },
                body: JSON.stringify({ matchId: report.matchId, winnerId: report.winnerId })
              });
              load();
            }}
            disabled={!report.tournamentId || !report.matchId || !report.winnerId}
          >
            Report match result
          </Button>
        </div>
      </Card>
      <Card title="Withdrawals (pending/failed)">
        <div className="space-y-2 text-xs text-slate-300">
          {withdrawals.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span>{tx.userId.slice(0, 6)} • {Number(tx.amount)} • {tx.status}</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/withdrawals/${tx.id}/approve`, { method: "POST", headers: { "x-admin-key": key } });
                    load();
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/withdrawals/${tx.id}/reject`, {
                      method: "POST",
                      headers: { "x-admin-key": key, "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: "manual reject" })
                    });
                    load();
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
          {!withdrawals.length && <p className="text-slate-500">No pending withdrawals.</p>}
        </div>
      </Card>
      <Card title="Deposits in Review">
        <div className="space-y-2 text-xs text-slate-300">
          {reviewDeposits.map((tx) => (
            <div key={tx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
              <span>{tx.userId.slice(0, 6)} • {Number(tx.amount)} • {tx.status}</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/deposits/${tx.id}/approve`, { method: "POST", headers: { "x-admin-key": key } });
                    load();
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/deposits/${tx.id}/reject`, {
                      method: "POST",
                      headers: { "x-admin-key": key, "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: "manual reject" })
                    });
                    load();
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
          {!reviewDeposits.length && <p className="text-slate-500">No deposits awaiting review.</p>}
        </div>
      </Card>
      <Card title="Wins in Review (large payouts)">
        <div className="space-y-2 text-xs text-slate-300">
          {reviewWins.map((tx) => (
            <div key={tx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
              <span>{tx.userId.slice(0, 6)} • {Number(tx.amount)} • {tx.status}</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/wins/${tx.id}/approve`, { method: "POST", headers: { "x-admin-key": key } });
                    load();
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`${API_URL}/admin/wins/${tx.id}/reject`, {
                      method: "POST",
                      headers: { "x-admin-key": key, "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: "manual reject" })
                    });
                    load();
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
          {!reviewWins.length && <p className="text-slate-500">No wins awaiting review.</p>}
        </div>
      </Card>
      <Card title="Recent Transactions">
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          <select
            className="rounded border border-white/10 bg-white/5 px-2 py-1"
            value={txFilter.type}
            onChange={(e) => setTxFilter((s) => ({ ...s, type: e.target.value }))}
          >
            <option value="">All types</option>
            <option value="deposit">Deposit</option>
            <option value="bet">Bet</option>
            <option value="win">Win</option>
            <option value="withdraw">Withdraw</option>
          </select>
          <select
            className="rounded border border-white/10 bg-white/5 px-2 py-1"
            value={txFilter.status}
            onChange={(e) => setTxFilter((s) => ({ ...s, status: e.target.value }))}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="locked">Locked</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-slate-300">
          {transactions
            .filter((t) => (!txFilter.type || t.type === txFilter.type) && (!txFilter.status || t.status === txFilter.status))
            .map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded border border-white/5 bg-white/5 px-3 py-1">
              <span>{t.type}</span>
              <span>{Number(t.amount)}</span>
              <span>{t.status}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Game Moves / Replay">
        <div className="flex flex-wrap gap-2">
          <input
            className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
            placeholder="Game Room ID"
            value={movesGameId}
            onChange={(e) => setMovesGameId(e.target.value)}
          />
          <Button
            variant="ghost"
            onClick={async () => {
              if (!movesGameId) return;
              const res = await fetch(`${API_URL}/admin/games/${movesGameId}/moves`, { headers: { "x-admin-key": key } });
              const data = await res.json();
              setMoves(data.moves ?? []);
            }}
            disabled={!movesGameId}
          >
            Load moves
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (!movesGameId) return;
              const res = await fetch(`${API_URL}/admin/games/${movesGameId}/replay.json`, { headers: { "x-admin-key": key } });
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${movesGameId}-replay.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={!movesGameId}
          >
            Download JSON
          </Button>
        </div>
        <div className="mt-3 space-y-1 text-[11px] text-slate-200">
          {moves.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-3 py-1">
              <span>{m.createdAt?.slice(11, 19) ?? ""}</span>
              <span className="text-xs text-slate-400">{m.playerId}</span>
              <span className="truncate">{JSON.stringify(m.move)}</span>
            </div>
          ))}
          {!moves.length && <p className="text-slate-500 text-sm">No moves loaded.</p>}
        </div>
      </Card>
    </div>
  );
}
