import express from "express";
import cors from "cors";
import { createServer } from "http";
import { prisma } from "./prisma";
import { config } from "./config";
import { WalletService } from "@modules/wallet";
import { MatchmakingService } from "@modules/matchmaking";
import { CryptoRouter, MockAdapter, type Network } from "@modules/crypto";
import { authMiddleware } from "./middlewares/auth";
import { generateReferralCode } from "@modules/referral";
import { attachRealtime } from "./realtime";
import { parseInitData, verifyTelegramInitData } from "./auth/telegram";
import { signJwt } from "./auth/jwt";
import { getLeaderboard } from "@modules/leaderboard";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const walletService = new WalletService(prisma);
const matchmaking = new MatchmakingService();
const crypto = new CryptoRouter();
crypto.register(new MockAdapter("USDT"));
crypto.register(new MockAdapter("ETH"));
crypto.register(new MockAdapter("POLYGON"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
  const { amount, network, txHash } = req.body as { amount: number; network: Network; txHash?: string };
  const { wallet } = await walletService.deposit(req.user!.id, amount, { network, txHash });
  res.json({ balance: wallet.balance });
});

app.post("/wallet/withdraw", authMiddleware(config.jwtSecret, prisma), async (req, res) => {
  const { amount, network, address } = req.body as { amount: number; network: Network; address: string };
  const { transaction } = await walletService.requestWithdraw(req.user!.id, amount, { network, address });
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
