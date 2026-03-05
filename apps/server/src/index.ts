import express from "express";
import cors from "cors";
import { createServer } from "http";
import { prisma } from "./prisma";
import { config } from "./config";
import { WalletService } from "@modules/wallet";
import { MatchmakingService, RedisMatchmakingStore } from "@modules/matchmaking";
import { CryptoRouter, MockAdapter, type Network } from "@modules/crypto";
import { authMiddleware } from "./middlewares/auth";
import { generateReferralCode } from "@modules/referral";
import { attachRealtime } from "./realtime";
import { parseInitData, verifyTelegramInitData } from "./auth/telegram";
import { signJwt } from "./auth/jwt";
import { getLeaderboard } from "@modules/leaderboard";
import { TournamentService } from "./tournaments/service";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const walletService = new WalletService(prisma);
let matchmakingStore: any = undefined;
if (config.redisUrl) {
  try {
    matchmakingStore = new RedisMatchmakingStore(config.redisUrl);
    console.log("Matchmaking using Redis store");
  } catch (e) {
    console.warn("Redis matchmaking store unavailable, falling back to memory:", (e as Error).message);
  }
}
const matchmaking = new MatchmakingService(45_000, 0.05, matchmakingStore as any);
const tournamentService = new TournamentService(prisma, walletService);
const crypto = new CryptoRouter();
crypto.register(new MockAdapter("USDT"));
crypto.register(new MockAdapter("ETH"));
crypto.register(new MockAdapter("POLYGON"));

// Flash Cup cron (simple interval)
if (config.flashCupIntervalMinutes > 0) {
  const intervalMs = config.flashCupIntervalMinutes * 60 * 1000;
  const tick = () =>
    tournamentService
      .maybeCreateFlashCup({
        intervalMinutes: config.flashCupIntervalMinutes,
        entryFee: config.flashCupEntry,
        prizePool: config.flashCupPrize
      })
      .catch((e) => console.warn("flash cup tick failed", e));
  tick();
  setInterval(tick, intervalMs);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/metrics", async (_req, res) => {
  const activeRooms = await prisma.gameRoom.count({ where: { status: { in: ["waiting", "active"] } } });
  const finishedRooms = await prisma.gameRoom.count({ where: { status: "finished" } });
  const { totalQueued, matchedCount } = matchmaking.stats();
  const reviewDeposits = await prisma.transaction.count({ where: { type: "deposit", status: "review" } });
  const pendingWithdrawals = await prisma.transaction.count({ where: { type: "withdraw", status: { in: ["pending", "review"] } } });
   const flashCups = await prisma.tournament.count({ where: { title: "Flash Cup" } });
  res.set("Content-Type", "text/plain");
  res.send(
    [
      `gametg_active_rooms ${activeRooms}`,
      `gametg_finished_rooms ${finishedRooms}`,
      `gametg_matchmaking_queue ${totalQueued}`,
      `gametg_matchmaking_matched_total ${matchedCount}`,
      `gametg_deposits_review ${reviewDeposits}`,
      `gametg_withdrawals_pending ${pendingWithdrawals}`,
      `gametg_flash_cups ${flashCups}`
    ].join("\n")
  );
});

app.get("/games", (_req, res) => {
  res.json({
    games: [
      { id: 1, name: "Blitz Chess", type: "strategy", status: "live", players_online: 342, prize_pool: 250, difficulty: "Medium", tags: ["featured", "trending"] },
      { id: 2, name: "Reaction Duel", type: "reaction", status: "live", players_online: 290, prize_pool: 120, difficulty: "Easy", tags: ["featured"] },
      { id: 3, name: "Quick Strategy Battle", type: "strategy", status: "live", players_online: 180, prize_pool: 180, difficulty: "Hard", tags: ["trending"] },
      { id: 4, name: "Arcade Score Challenge", type: "arcade", status: "live", players_online: 210, prize_pool: 90, difficulty: "Medium", tags: ["new"] },
      { id: 5, name: "Duel Rush", type: "duel", status: "live", players_online: 150, prize_pool: 110, difficulty: "Medium", tags: ["trending"] }
    ]
  });
});

// Keep compatibility with frontend that may call /api/games
app.get("/api/games", (_req, res) => {
  res.redirect(307, "/games");
});

// Tournaments API (minimal)
app.get("/tournaments", async (_req, res) => {
  const list = await tournamentService.list();
  res.json({ tournaments: list });
});

app.get("/flashcup", async (_req, res) => {
  const t = await tournamentService.maybeCreateFlashCup({
    intervalMinutes: config.flashCupIntervalMinutes,
    entryFee: config.flashCupEntry,
    prizePool: config.flashCupPrize
  });
  res.json({ tournament: t });
});

app.get("/tournaments/:id", async (req, res) => {
  const t = await tournamentService.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Not found" });
  res.json({ tournament: t });
});

app.post("/tournaments", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  if (req.user?.id !== config.adminApiKey && req.headers["x-admin-key"] !== config.adminApiKey) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { title, game, entryFee, prizePool, startsAt } = req.body;
  const t = await tournamentService.create({ title, game, entryFee: Number(entryFee ?? 0), prizePool: prizePool ? Number(prizePool) : undefined, startsAt: startsAt ? new Date(startsAt) : undefined, createdById: req.user?.id });
  res.json({ tournament: t });
});

app.post("/tournaments/:id/start", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  if (req.user?.id !== config.adminApiKey && req.headers["x-admin-key"] !== config.adminApiKey) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const bracket = await tournamentService.seedBracket(req.params.id);
  res.json({ bracket });
});

app.post("/tournaments/:id/join", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const t = await tournamentService.join(req.params.id, req.user!.id);
  res.json({ participant: t });
});

app.post("/tournaments/:id/report", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  if (req.user?.id !== config.adminApiKey && req.headers["x-admin-key"] !== config.adminApiKey) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { matchId, winnerId, report } = req.body;
  const m = await tournamentService.reportMatch(req.params.id, matchId, winnerId, report);
  res.json({ match: m });
});

// External match report (for Dota/CS/WoT webhook)
app.post("/tournaments/:id/report/external", async (req, res) => {
  const { externalMatchId, winnerId, report } = req.body;
  if (!externalMatchId || !winnerId) return res.status(400).json({ error: "Missing data" });
  try {
    const m = await tournamentService.reportExternal(req.params.id, externalMatchId, winnerId, report);
    res.json({ match: m });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/auth/telegram", async (req, res) => {
  const { initData, referralCode } = req.body as { initData: string; referralCode?: string };
  if (!initData) return res.status(400).json({ error: "Missing initData" });

  if (!verifyTelegramInitData(initData, config.telegramBotToken)) {
    return res.status(401).json({ error: "Invalid Telegram data" });
  }

  const parsed = parseInitData(initData);
  if (!parsed.user) return res.status(400).json({ error: "Missing user" });

  const telegramId = String(parsed.user.id);
  const username = parsed.user.username ?? `${parsed.user.first_name ?? ""} ${parsed.user.last_name ?? ""}`.trim();
  const startParam = parsed.start_param ?? referralCode;

  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    const referredBy = startParam
      ? await prisma.user.findUnique({ where: { referralCode: startParam } })
      : null;

    user = await prisma.user.create({
      data: {
        telegramId,
        username: username || null,
        referralCode: generateReferralCode(telegramId),
        referredById: referredBy?.id
      }
    });
  }

  if (user.isBanned) return res.status(403).json({ error: "Access denied" });

  await walletService.getOrCreateWallet(user.id);

  const token = signJwt({ sub: user.id, telegramId: user.telegramId }, config.jwtSecret);
  res.json({ token, user });
});

app.post("/auth/dev", async (req, res) => {
  if (!config.enableDevAuth) return res.status(404).json({ error: "Disabled" });
  const { telegramId, username, referralCode } = req.body as { telegramId?: string; username?: string; referralCode?: string };
  const resolvedTelegramId = telegramId ?? `dev_${Date.now()}`;

  let user = await prisma.user.findUnique({ where: { telegramId: resolvedTelegramId } });
  if (!user) {
    const referredBy = referralCode
      ? await prisma.user.findUnique({ where: { referralCode } })
      : null;
    user = await prisma.user.create({
      data: {
        telegramId: resolvedTelegramId,
        username: username ?? `dev_${resolvedTelegramId}`,
        referralCode: generateReferralCode(resolvedTelegramId),
        referredById: referredBy?.id
      }
    });
  }

  if (user.isBanned) return res.status(403).json({ error: "Access denied" });

  await walletService.getOrCreateWallet(user.id);
  const token = signJwt({ sub: user.id, telegramId: user.telegramId }, config.jwtSecret);
  res.json({ token, user });
});

app.get("/me", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  res.json({ user });
});

app.get("/wallet", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const balance = await walletService.getBalance(req.user!.id);
  res.json({ balance });
});

app.post("/wallet/deposit-address", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { network } = req.body as { network: Network };
  const adapter = crypto.getAdapter(network);
  const address = await adapter.createDepositAddress(req.user!.id);
  res.json(address);
});

app.post("/wallet/deposit", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { amount, network, txHash, device } = req.body as { amount: number; network: Network; txHash?: string; device?: string };
  const ip = (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress;
  const referenceId = txHash ? `dep:${network}:${txHash}` : undefined;
  const { wallet, transaction } = await walletService.deposit(req.user!.id, amount, { network, txHash, ip, device }, referenceId);
  res.json({ balance: wallet.balance, status: transaction.status, risk: (transaction.metadata as any)?.riskFlags ?? [] });
});

app.post("/wallet/withdraw", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { amount, network, address } = req.body as { amount: number; network: Network; address: string };
  const referenceId = `wd:${network}:${address}:${amount}`;
  const { transaction } = await walletService.requestWithdraw(req.user!.id, amount, { network, address }, referenceId);
  res.json({ transaction });
});

app.get("/rooms", authMiddleware(config.jwtSecret, prisma), async (_req, res) => {
  const rooms = await prisma.gameRoom.findMany({
    where: { status: { in: ["waiting", "active"] }, isPrivate: false },
    orderBy: { createdAt: "desc" }
  });
  res.json({ rooms });
});

app.get("/leaderboard", authMiddleware(config.jwtSecret, prisma), async (_req, res) => {
  const leaderboard = await getLeaderboard(prisma);
  res.json({ leaderboard });
});

// Invite keys (viral loop)
app.post("/invites/key", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { usesLeft = 3, rewardType = "nitro", days = 3 } = req.body as { usesLeft?: number; rewardType?: string; days?: number };
  const key = await prisma.inviteKey.create({
    data: {
      ownerId: req.user!.id,
      usesLeft,
      rewardType,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    }
  });
  res.json({ key });
});

app.post("/invites/claim", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { keyId } = req.body as { keyId: string };
  const key = await prisma.inviteKey.findUnique({ where: { id: keyId } });
  if (!key) return res.status(404).json({ error: "Key not found" });
  if (key.expiresAt < new Date()) return res.status(400).json({ error: "Expired" });
  if (key.usesLeft <= 0) return res.status(400).json({ error: "No uses left" });

  const already = await prisma.inviteClaim.findFirst({ where: { keyId, userId: req.user!.id } });
  if (already) return res.status(400).json({ error: "Already claimed" });

  await prisma.inviteKey.update({ where: { id: keyId }, data: { usesLeft: { decrement: 1 } } });
  await prisma.inviteClaim.create({ data: { keyId, userId: req.user!.id } });
  // progress team quest
  await prisma.teamQuest.upsert({
    where: { userId: req.user!.id },
    update: { progress: { increment: 1 } },
    create: {
      userId: req.user!.id,
      progress: 1,
      target: 5,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    }
  });

  if (key.rewardType === "nitro") {
    await walletService.deposit(req.user!.id, config.inviteKeyReward, { source: "invite_key", keyId });
  }
  res.json({ rewardType: key.rewardType });
});

// Team quest (invite/duo chest)
app.get("/quests/team", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const existing = await prisma.teamQuest.findUnique({ where: { userId: req.user!.id } });
  if (existing) return res.json({ quest: existing });
  const quest = await prisma.teamQuest.create({
    data: {
      userId: req.user!.id,
      target: 5,
      progress: 0,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    }
  });
  res.json({ quest });
});

app.post("/quests/team/progress", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { inc = 1 } = req.body as { inc?: number };
  const quest = await prisma.teamQuest.upsert({
    where: { userId: req.user!.id },
    update: { progress: { increment: inc } },
    create: {
      userId: req.user!.id,
      target: 5,
      progress: inc,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    }
  });
  res.json({ quest });
});

app.post("/quests/team/claim", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const quest = await prisma.teamQuest.findUnique({ where: { userId: req.user!.id } });
  if (!quest) return res.status(404).json({ error: "Quest missing" });
  if (quest.rewardClaimed) return res.status(400).json({ error: "Already claimed" });
  if (quest.progress < quest.target) return res.status(400).json({ error: "Not complete" });
  await prisma.teamQuest.update({ where: { id: quest.id }, data: { rewardClaimed: true } });
  // reward: small bonus deposited
  await walletService.deposit(req.user!.id, config.teamQuestReward, { source: "team_chest" });
  res.json({ ok: true, reward: config.teamQuestReward });
});

app.get("/referrals", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { referrals: true }
  });
  const rewards = await prisma.referralReward.findMany({ where: { referrerId: req.user!.id } });
  res.json({
    referralCode: user?.referralCode,
    totalInvited: user?.referrals.length ?? 0,
    totalRewards: rewards.reduce((sum, r) => sum + Number(r.amount), 0),
    rewards
  });
});

const adminGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== config.adminApiKey) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

app.get("/admin/overview", adminGuard, async (_req, res) => {
  const totalUsers = await prisma.user.count();
  const finishedGames = await prisma.gameRoom.findMany({
    where: { status: "finished" },
    select: { stake: true }
  });
  const totalVolume = finishedGames.reduce((sum, room) => sum + Number(room.stake) * 2, 0);
  const totalFees = totalVolume * (config.platformFeeBps / 10000);
  const totalRewards = await prisma.referralReward.aggregate({ _sum: { amount: true } });
  res.json({
    totalUsers,
    totalGames: finishedGames.length,
    totalVolume,
    totalFees,
    totalReferralRewards: Number(totalRewards._sum.amount ?? 0)
  });
});

app.get("/admin/users", adminGuard, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ users });
});

app.get("/admin/games/:id/moves", adminGuard, async (req, res) => {
  const { id } = req.params;
  const moves = await prisma.gameMove.findMany({
    where: { gameId: id },
    orderBy: { createdAt: "asc" }
  });
  res.json({ moves });
});

app.get("/admin/games/:id/replay.json", adminGuard, async (req, res) => {
  const { id } = req.params;
  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room) return res.status(404).json({ error: "Not found" });
  const moves = await prisma.gameMove.findMany({ where: { gameId: id }, orderBy: { createdAt: "asc" } });
  res.json({ room, moves });
});

app.get("/admin/anomaly/scan", adminGuard, async (_req, res) => {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const finished = await prisma.gameRoom.findMany({
    where: { createdAt: { gte: since }, status: "finished" },
    include: { moves: true },
    take: 200
  });
  const fastGames = finished.filter((g) => g.moves.length < 2).length;
  const repeatPairs = await prisma.gameRoom.groupBy({
    by: ["player1Id", "player2Id"],
    where: { createdAt: { gte: since }, player2Id: { not: null } },
    _count: { _all: true },
    having: { _count: { _all: { gt: 3 } } }
  });
  res.json({ fastGames, repeatPairs });
});

app.get("/admin/risk/report", adminGuard, async (_req, res) => {
  const reviewDeposits = await prisma.transaction.count({ where: { type: "deposit", status: "review" } });
  const reviewWins = await prisma.transaction.count({ where: { type: "win", status: "review" } });
  const reviewWithdraws = await prisma.transaction.count({ where: { type: "withdraw", status: { in: ["review", "pending"] } } });
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const fastList = await prisma.gameRoom.findMany({
    where: { createdAt: { gte: since }, status: "finished" },
    take: 50,
    orderBy: { createdAt: "desc" },
    include: { moves: true }
  });
  const shortGames = fastList.filter((g) => g.moves.length < 2).length;
  const repeatPairs = await prisma.gameRoom.groupBy({
    by: ["player1Id", "player2Id"],
    where: { createdAt: { gte: since }, player2Id: { not: null } },
    _count: { _all: true },
    having: { _count: { _all: { gt: 3 } } }
  });
  res.json({ reviewDeposits, reviewWins, reviewWithdraws, shortGames, repeatPairs });
});

app.get("/admin/transactions", adminGuard, async (_req, res) => {
  const transactions = await prisma.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ transactions });
});

app.get("/admin/deposits/review", adminGuard, async (_req, res) => {
  const review = await prisma.transaction.findMany({
    where: { type: "deposit", status: "review" },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ review });
});

app.post("/admin/deposits/:id/approve", adminGuard, async (req, res) => {
  const { id } = req.params;
  const tx = await walletService.approveDeposit(id);
  res.json({ transaction: tx });
});

app.post("/admin/deposits/:id/reject", adminGuard, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };
  const tx = await walletService.rejectDeposit(id, reason);
  res.json({ transaction: tx });
});

app.get("/admin/wins/review", adminGuard, async (_req, res) => {
  const review = await prisma.transaction.findMany({
    where: { type: "win", status: "review" },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ review });
});

app.post("/admin/wins/:id/approve", adminGuard, async (req, res) => {
  const { id } = req.params;
  const tx = await walletService.approveWin(id);
  res.json({ transaction: tx });
});

app.post("/admin/wins/:id/reject", adminGuard, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };
  const tx = await walletService.rejectWin(id, reason);
  res.json({ transaction: tx });
});

app.get("/admin/withdrawals", adminGuard, async (_req, res) => {
  const pending = await prisma.transaction.findMany({
    where: { type: "withdraw", status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ withdrawals: pending });
});

app.get("/admin/metrics", adminGuard, async (_req, res) => {
  res.json({
    matchmaking: matchmaking.stats()
  });
});

app.post("/admin/withdrawals/:id/approve", adminGuard, async (req, res) => {
  const { id } = req.params;
  const tx = await walletService.approveWithdraw(id);
  res.json({ transaction: tx });
});

app.post("/admin/withdrawals/:id/reject", adminGuard, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };
  const tx = await walletService.rejectWithdraw(id, reason);
  res.json({ transaction: tx });
});

app.patch("/admin/ban/:id", adminGuard, async (req, res) => {
  const { id } = req.params;
  const { banned } = req.body as { banned: boolean };
  const user = await prisma.user.update({ where: { id }, data: { isBanned: banned } });
  res.json({ user });
});

const server = createServer(app);
attachRealtime(server, prisma, walletService, matchmaking, config.jwtSecret, config.platformFeeBps, config.referralShare);

server.listen(config.port, () => {
  console.log(`Server running on :${config.port}`);
});
