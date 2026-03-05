import type { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { MatchmakingService, type MatchmakingEntry } from "@modules/matchmaking";
import { WalletService } from "@modules/wallet";
import { computePlatformFee, computeReferralRewardFromFee } from "@modules/referral";
import { createGameEngine, createGameEngineWithPlayers, type GameType, type PlayerId } from "./games/registry";
import { verifyJwt } from "./auth/jwt";
import { config } from "./config";

interface RoomSession {
  roomId: string;
  roomCode: string;
  gameType: GameType;
  stake: number;
  status: "waiting" | "active" | "finished";
  isPrivate: boolean;
  player1: { userId: string; socketId: string };
  player2?: { userId: string; socketId: string };
  participants: { userId: string; socketId: string; slot?: PlayerId }[];
  engine: ReturnType<typeof createGameEngine> | ReturnType<typeof createGameEngineWithPlayers> | null;
  waitTimer?: NodeJS.Timeout;
  startTimer?: NodeJS.Timeout;
}

const generateRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const WAIT_TIMEOUT_MS = 60_000; // 60s waiting room timeout for 1v1
const MAFIA_WAIT_TIMEOUT_MS = 90_000;
const AMONGUS_WAIT_TIMEOUT_MS = 90_000;
const QUEUE_MIN_1V1 = 2;
const QUEUE_MAX_1V1 = 2; // extendable for party games
const MAFIA_MIN_PLAYERS = 5;
const MAFIA_MAX_PLAYERS = 10;
const AMONGUS_MIN_PLAYERS = 4;
const AMONGUS_MAX_PLAYERS = 10;
const MAFIA_START_DELAY_MS = 6_000; // allow a few seconds to top-up lobby once minimum reached
const AMONGUS_START_DELAY_MS = 6_000;
const HEARTBEAT_GRACE_MS = 20_000;
const MOVE_COOLDOWN_MS = 250;

const PARTY_GAMES: GameType[] = ["mafia", "amongus"];
const boundsForGame = (gameType: GameType) => {
  if (gameType === "mafia") return { min: MAFIA_MIN_PLAYERS, max: MAFIA_MAX_PLAYERS, waitMs: MAFIA_WAIT_TIMEOUT_MS, startDelay: MAFIA_START_DELAY_MS };
  if (gameType === "amongus") return { min: AMONGUS_MIN_PLAYERS, max: AMONGUS_MAX_PLAYERS, waitMs: AMONGUS_WAIT_TIMEOUT_MS, startDelay: AMONGUS_START_DELAY_MS };
  return { min: QUEUE_MIN_1V1, max: QUEUE_MAX_1V1, waitMs: WAIT_TIMEOUT_MS, startDelay: 0 };
};

const isPartyGame = (gameType: GameType) => PARTY_GAMES.includes(gameType);

const deepClone = <T>(data: T): T => JSON.parse(JSON.stringify(data));

function sanitizeState(gameType: GameType, state: any, viewer: PlayerId | string) {
  if (gameType === "battleship") {
  const copy = deepClone(state);
  const opponent: PlayerId = viewer === "p1" ? "p2" : "p1";
  const board = copy.boards?.[opponent];
  if (Array.isArray(board)) {
    for (const row of board) {
      for (const cell of row) {
        if (!cell.hit) cell.ship = false;
      }
    }
  }
    return copy;
  }
  if (gameType === "mafia") {
    // Hide roles except for own role; detective info is passed as flag per move
    const copy = deepClone(state);
    if (copy.players) {
      copy.players = copy.players.map((p: any) =>
        p.id === viewer ? p : { ...p, role: p.revealed ? p.role : undefined }
      );
    }
    return copy;
  }
  if (gameType === "amongus") {
    const copy = deepClone(state);
    if (copy.players) {
      const self = copy.players.find((p: any) => p.id === viewer);
      const isImpostor = self?.role === "impostor";
      copy.players = copy.players.map((p: any) => {
        const shouldReveal = p.id === viewer || copy.phase === "finished" || (isImpostor && p.role === "impostor");
        return shouldReveal ? p : { ...p, role: undefined };
      });
    }
    return copy;
  }
  return state;
}

export function attachRealtime(
  server: HttpServer,
  prisma: PrismaClient,
  walletService: WalletService,
  matchmaking: MatchmakingService,
  jwtSecret: string,
  feeBps = 500,
  referralShare = 0.1
) {
  const io = new SocketServer(server, {
    cors: { origin: "*" }
  });

  const sessions = new Map<string, RoomSession>();
  const sessionsByCode = new Map<string, RoomSession>();
  const lastSeen = new Map<string, number>();
  const lastMoveAt = new Map<string, number>();

  const ensureAuthed = (socket: any) => {
    if (!socket.data.userId) throw new Error("Unauthenticated");
  };

  const emitState = (session: RoomSession, event: string, payload: Record<string, unknown>) => {
    if (isPartyGame(session.gameType)) {
      for (const p of session.participants) {
        const state = sanitizeState(session.gameType, payload.state, p.userId);
        io.to(p.socketId).emit(event, { ...payload, state, player: p.userId });
      }
      return;
    }

    if (!session.player1 || !session.player2) return;
    const stateP1 = sanitizeState(session.gameType, payload.state, "p1");
    const stateP2 = sanitizeState(session.gameType, payload.state, "p2");
    io.to(session.player1.socketId).emit(event, { ...payload, state: stateP1, player: "p1" });
    io.to(session.player2.socketId).emit(event, { ...payload, state: stateP2, player: "p2" });
  };

  const startGame = async (session: RoomSession) => {
    if (session.waitTimer) {
      clearTimeout(session.waitTimer);
      session.waitTimer = undefined;
    }
    if (session.startTimer) {
      clearTimeout(session.startTimer);
      session.startTimer = undefined;
    }

    if (isPartyGame(session.gameType)) {
      const bounds = boundsForGame(session.gameType);
      if (session.participants.length < bounds.min) {
        throw new Error("Not enough players to start");
      }
      session.engine = createGameEngineWithPlayers(session.gameType, session.participants.map((p) => p.userId));
    } else {
      if (!session.player2) throw new Error("Opponent missing");
      session.engine = createGameEngine(session.gameType);
    }
    session.status = "active";

    await prisma.gameRoom.update({
      where: { id: session.roomId },
      data: { status: "active", player2Id: session.player2?.userId }
    });

    emitState(session, "start_game", {
      roomId: session.roomId,
      gameType: session.gameType,
      stake: session.stake,
      state: session.engine.state
    });
  };

  const endGame = async (session: RoomSession, winnerIds: string[], reason: string, payoutMode: "winner_take_all" | "split" = "winner_take_all") => {
    if (session.status === "finished") return;
    session.status = "finished";

    const participantIds = session.participants.map((p) => p.userId);
    const uniqueWinners = Array.from(new Set(winnerIds)).filter((id) => participantIds.includes(id));
    const winnerId = uniqueWinners[0] ?? null;

    // idempotent guard: if already finished in DB, skip payouts
    const existing = await prisma.gameRoom.findUnique({ where: { id: session.roomId }, select: { status: true, winnerId: true } });
    if (existing?.status === "finished" || existing?.status === "cancelled") return;

    await prisma.gameRoom.update({
      where: { id: session.roomId },
      data: {
        status: winnerId ? "finished" : "cancelled",
        winnerId
      }
    });
    // Duo boost + quest progress (only 1v1 games)
    if (!isPartyGame(session.gameType) && session.player2) {
      const p1 = session.player1.userId;
      const p2 = session.player2.userId;
      const users = await prisma.user.findMany({ where: { id: { in: [p1, p2] } }, select: { id: true, referredById: true } });
      const u1 = users.find((u) => u.id === p1);
      const u2 = users.find((u) => u.id === p2);
      const referralLinked = (u1?.referredById === p2) || (u2?.referredById === p1);

      if (referralLinked) {
        for (const pid of [p1, p2]) {
          await prisma.teamQuest.upsert({
            where: { userId: pid },
            update: { progress: { increment: 1 } },
            create: {
              userId: pid,
              progress: 1,
              target: 5,
              expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            }
          });
        }
      }

      // Duo boost: after 3 matches together, grant boost for both
      const pairUpdate = async (userId: string, partnerId: string) => {
        const duo = await prisma.duoBoost.upsert({
          where: { userId_partnerId: { userId, partnerId } },
          update: { count: { increment: 1 } },
          create: { userId, partnerId, count: 1 }
        });
        if (!duo.activated && duo.count >= 3) {
          await prisma.userBoost.create({
            data: { userId, type: "duo", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
          });
          await prisma.duoBoost.update({ where: { id: duo.id }, data: { activated: true } });
          await walletService.deposit(userId, config.duoBonusReward, { source: "duo_boost", partnerId });
        }
      };
      await pairUpdate(p1, p2);
      await pairUpdate(p2, p1);
    }

    if (uniqueWinners.length === 0) {
      // Refund locked stakes for everyone
      for (const pid of participantIds) {
        await walletService.refundBet(pid, session.stake, { roomId: session.roomId, reason });
      }
      io.to(session.roomId).emit("game_end", { winner: null, winners: [], reason });
      return;
    }

    const totalPot = session.stake * participantIds.length;
    const fee = computePlatformFee(totalPot, feeBps);
    const referralReward = computeReferralRewardFromFee(fee, referralShare);
    const payoutPool = totalPot - fee;
    const perWinner = payoutMode === "split" ? payoutPool / uniqueWinners.length : payoutPool;

    for (const id of uniqueWinners) {
      await walletService.settleWin(id, perWinner, { roomId: session.roomId, fee, mode: payoutMode });
    }

    const players = await prisma.user.findMany({
      where: { id: { in: participantIds } },
      select: { id: true, referredById: true }
    });
    const referrals = players.map((p) => p.referredById).filter((id): id is string => !!id);

    if (referrals.length > 0) {
      const perReferrer = Number((referralReward / referrals.length).toFixed(8));
      for (const referrerId of referrals) {
        await prisma.referralReward.create({
          data: { referrerId, userId: winnerId ?? uniqueWinners[0], amount: perReferrer }
        });
        await walletService.deposit(referrerId, perReferrer, {
          source: "referral",
          roomId: session.roomId
        });
      }
    }

    io.to(session.roomId).emit("game_end", {
      winner: winnerId,
      winners: uniqueWinners,
      payout: payoutMode === "split" ? perWinner : payoutPool,
      fee,
      referralReward,
      reason
    });
  };

  const createRoomForUser = async ({
    socket,
    userId,
    gameType,
    stake,
    isPrivate
  }: {
    socket: any;
    userId: string;
    gameType: GameType;
    stake: number;
    isPrivate: boolean;
  }) => {
    if (stake <= 0) throw new Error("Invalid stake");
    const roomCode = generateRoomCode();

    const room = await prisma.gameRoom.create({
      data: {
        gameType,
        stake,
        status: "waiting",
        player1Id: userId,
        roomCode,
        isPrivate
      }
    });

    await walletService.lockForBet(userId, stake, { gameType, roomCode, roomId: room.id });

    const session: RoomSession = {
      roomId: room.id,
      roomCode,
      gameType,
      stake,
      status: "waiting",
      isPrivate,
      player1: { userId, socketId: socket.id },
      participants: [{ userId, socketId: socket.id, slot: "p1" }],
      engine: null
    };

    // auto-timeout waiting room to avoid stuck locked stakes
    session.waitTimer = setTimeout(async () => {
      if (session.status !== "waiting") return;
      await endGame(session, [], "timeout_waiting");
    }, boundsForGame(gameType).waitMs);

    sessions.set(room.id, session);
    sessionsByCode.set(roomCode, session);
    socket.join(room.id);

    socket.emit("room_created", { roomId: room.id, roomCode, isPrivate });

    return session;
  };

  io.on("connection", (socket) => {
    socket.on("authenticate", async ({ token }: { token: string }) => {
      try {
        const payload = verifyJwt(token, jwtSecret);
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { isBanned: true }
        });
        if (!user || user.isBanned) {
          socket.emit("error", { message: "Access denied" });
          socket.disconnect();
          return;
        }
        socket.data.userId = payload.sub;
        socket.emit("authenticated", { ok: true, userId: payload.sub });
        lastSeen.set(socket.id, Date.now());
      } catch {
        socket.emit("error", { message: "Invalid token" });
      }
    });

    socket.on("heartbeat", () => {
      lastSeen.set(socket.id, Date.now());
    });

    socket.on("create_room", async ({ gameType, stake, isPrivate }: { gameType: GameType; stake: number; isPrivate: boolean }) => {
      try {
        ensureAuthed(socket);
        const userId = socket.data.userId as string;
        await createRoomForUser({ socket, userId, gameType, stake, isPrivate });
      } catch (error: any) {
        socket.emit("error", { message: error.message ?? "Failed to create room" });
      }
    });

    socket.on("join_room", async ({ roomCode, roomId }: { roomCode?: string; roomId?: string }) => {
      try {
        ensureAuthed(socket);
        const session = roomId ? sessions.get(roomId) : roomCode ? sessionsByCode.get(roomCode) : undefined;
        if (!session || session.status === "finished") throw new Error("Room not available");
        if (session.isPrivate && session.roomCode !== roomCode) throw new Error("Room is private");

        const userId = socket.data.userId as string;
        const already = session.participants.find((p) => p.userId === userId);
        if (already) {
          already.socketId = socket.id;
          if (session.player1.userId === userId) session.player1.socketId = socket.id;
          if (session.player2?.userId === userId) session.player2.socketId = socket.id;
          socket.join(session.roomId);
          if (session.engine) {
            emitState(session, "start_game", {
              roomId: session.roomId,
              gameType: session.gameType,
              stake: session.stake,
              state: session.engine.state
            });
          }
          return;
        }

        if (isPartyGame(session.gameType)) {
          const bounds = boundsForGame(session.gameType);
          if (session.participants.length >= bounds.max) throw new Error("Room is full");
          await walletService.lockForBet(userId, session.stake, { gameType: session.gameType, roomCode: session.roomCode, roomId: session.roomId });
          session.participants.push({ userId, socketId: socket.id });
          if (!session.player2) session.player2 = { userId, socketId: socket.id }; // compatibility for legacy consumer
          socket.join(session.roomId);
          io.to(session.roomId).emit("lobby_update", { roomId: session.roomId, count: session.participants.length });

          // Start once minimum reached with short buffer, or immediately at cap
          if (session.participants.length >= bounds.min && !session.startTimer) {
            session.startTimer = setTimeout(() => startGame(session).catch(console.error), bounds.startDelay);
          }
          if (session.participants.length === bounds.max) {
            await startGame(session);
          }
          return;
        }

        if (session.player2) throw new Error("Room is full");

        await walletService.lockForBet(userId, session.stake, { gameType: session.gameType, roomCode: session.roomCode, roomId: session.roomId });
        session.player2 = { userId, socketId: socket.id };
        session.participants.push({ userId, socketId: socket.id });

        if (session.waitTimer) {
          clearTimeout(session.waitTimer);
          session.waitTimer = undefined;
        }

        await prisma.gameRoom.update({
          where: { id: session.roomId },
          data: { player2Id: userId, status: "active" }
        });

        socket.join(session.roomId);
        io.to(session.roomId).emit("match_found", { roomId: session.roomId, roomCode: session.roomCode });
        await startGame(session);
      } catch (error: any) {
        socket.emit("error", { message: error.message ?? "Failed to join room" });
      }
    });

    socket.on("join_random", async ({ gameType, stake }: { gameType: GameType; stake: number }) => {
      try {
        ensureAuthed(socket);
        const userId = socket.data.userId as string;
        const bounds = boundsForGame(gameType);
        const ticket: MatchmakingEntry = { socketId: socket.id, userId, gameType, stake, createdAt: Date.now() };

        if (bounds.max === 2) {
          const opponent = matchmaking.dequeueMatch(gameType, stake);
          if (!opponent) {
            matchmaking.enqueue(ticket);
            socket.emit("match_waiting", { gameType, stake });
            return;
          }

          const hostTicket = opponent;
          const hostSocket = hostTicket.userId === userId ? socket : io.sockets.sockets.get(hostTicket.socketId);
          if (!hostSocket && hostTicket.userId !== userId) {
            // opponent disconnected, re-queue them and wait
            matchmaking.enqueue(hostTicket);
            matchmaking.enqueue(ticket);
            socket.emit("match_waiting", { gameType, stake });
            return;
          }
          const session = await createRoomForUser({ socket: hostSocket ?? socket, userId: hostTicket.userId, gameType, stake, isPrivate: false });

          // current player joins as second
          await walletService.lockForBet(userId, stake, { gameType, roomCode: session.roomCode, roomId: session.roomId });
          session.player2 = { userId, socketId: socket.id };
          session.participants.push({ userId, socketId: socket.id, slot: "p2" });

          if (session.waitTimer) {
            clearTimeout(session.waitTimer);
            session.waitTimer = undefined;
          }

          await prisma.gameRoom.update({
            where: { id: session.roomId },
            data: { player2Id: userId, status: "active" }
          });

          socket.join(session.roomId);
          io.to(session.roomId).emit("match_found", { roomId: session.roomId, roomCode: session.roomCode });
          await startGame(session);
          return;
        }

        // multiplayer queue (party games)
        const group = matchmaking.dequeueGroup({ gameType, stake, min: bounds.min - 1, max: bounds.max - 1 });
        if (!group) {
          matchmaking.enqueue(ticket);
          socket.emit("match_waiting", { gameType, stake });
          return;
        }

        const members = [...group, ticket].filter(
          (m, idx, arr) => arr.findIndex((x) => x.userId === m.userId) === idx
        );

        const session = await createRoomForUser({ socket, userId, gameType, stake, isPrivate: false });

        for (const m of members) {
          if (m.userId === userId) continue; // host already added
          const memberSocket = io.sockets.sockets.get(m.socketId);
          if (!memberSocket) continue;
          await walletService.lockForBet(m.userId, stake, { gameType, roomCode: session.roomCode, roomId: session.roomId });
          session.participants.push({ userId: m.userId, socketId: memberSocket.id });
          memberSocket.join(session.roomId);
        }

        io.to(session.roomId).emit("lobby_update", { roomId: session.roomId, count: session.participants.length });
        if (session.participants.length >= bounds.min && !session.startTimer) {
          session.startTimer = setTimeout(() => startGame(session).catch(console.error), bounds.startDelay);
        }
        if (session.participants.length === bounds.max) {
          await startGame(session);
        } else {
          io.to(session.roomId).emit("match_found", { roomId: session.roomId, roomCode: session.roomCode, players: session.participants.length });
        }
      } catch (error: any) {
        socket.emit("error", { message: error.message ?? "Failed to join random" });
      }
    });

    socket.on("move", async ({ roomId, move }: { roomId: string; move: unknown }) => {
      try {
        ensureAuthed(socket);
        const session = sessions.get(roomId);
        if (!session || !session.engine) throw new Error("Room not active");

        const now = Date.now();
        const prev = lastMoveAt.get(socket.id) ?? 0;
        if (now - prev < MOVE_COOLDOWN_MS) {
          socket.emit("move_rejected", { reason: "rate_limited" });
          return;
        }
        lastMoveAt.set(socket.id, now);

        const userId = socket.data.userId as string;
        if (isPartyGame(session.gameType)) {
          const participant = session.participants.find((p) => p.userId === userId);
          if (!participant) throw new Error("Not a participant");
          const result = session.engine.applyMove(userId, move);
          if (!result.valid) {
            socket.emit("move_rejected", { reason: result.error });
            return;
          }
          await prisma.gameMove.create({ data: { gameId: roomId, playerId: userId, move: move as any } });
          emitState(session, "move", { player: userId, move, state: result.state });

          if (result.outcome?.status === "win") {
            await endGame(session, result.outcome.winners ?? [userId], "win", "split");
          } else if (result.outcome?.status === "draw") {
            await endGame(session, [], "draw");
          }
          return;
        }

        const player: PlayerId | null = session.player1.userId === userId ? "p1" : session.player2?.userId === userId ? "p2" : null;
        if (!player) throw new Error("Not a participant");

        const result = session.engine.applyMove(player, move);
        if (!result.valid) {
          socket.emit("move_rejected", { reason: result.error });
          return;
        }

        await prisma.gameMove.create({
          data: { gameId: roomId, playerId: userId, move: move as any }
        });

        emitState(session, "move", { player, move, state: result.state });

        if (result.outcome?.status === "win") {
          const winnerId = result.outcome.winner === "p1" ? session.player1.userId : session.player2?.userId;
          await endGame(session, winnerId ? [winnerId] : [], "win");
        } else if (result.outcome?.status === "draw") {
          await endGame(session, [], "draw");
        }
      } catch (error: any) {
        socket.emit("error", { message: error.message ?? "Move failed" });
      }
    });

    socket.on("disconnect", async () => {
      matchmaking.removeBySocket(socket.id);
      lastSeen.delete(socket.id);
      lastMoveAt.delete(socket.id);
      for (const session of sessions.values()) {
        if (session.status === "finished") continue;
        const participant = session.participants.find((p) => p.socketId === socket.id);
        if (!participant) continue;

        if (isPartyGame(session.gameType)) {
          const bounds = boundsForGame(session.gameType);
          session.participants = session.participants.filter((p) => p.userId !== participant.userId);
          await walletService.refundBet(participant.userId, session.stake, { roomId: session.roomId, reason: "disconnect" });
          io.to(session.roomId).emit("lobby_update", { roomId: session.roomId, count: session.participants.length });
          if (session.participants.length < bounds.min && session.startTimer) {
            clearTimeout(session.startTimer);
            session.startTimer = undefined;
          }
          if (session.status === "active") {
            await endGame(session, [], "disconnect");
          }
          continue;
        }

        const isPlayer1 = session.player1.socketId === socket.id;
        const isPlayer2 = session.player2?.socketId === socket.id;
        if (!isPlayer1 && !isPlayer2) continue;
        if (session.status === "waiting") {
          await endGame(session, [], "disconnect");
        } else {
          const winner: PlayerId = isPlayer1 ? "p2" : "p1";
          const winnerId = winner === "p1" ? session.player1.userId : session.player2?.userId;
          await endGame(session, winnerId ? [winnerId] : [], "disconnect");
        }
      }
    });
  });

  // Heartbeat watchdog
  setInterval(() => {
    const now = Date.now();
    for (const [sid, ts] of lastSeen.entries()) {
      if (now - ts > HEARTBEAT_GRACE_MS) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.disconnect(true);
      }
    }
  }, HEARTBEAT_GRACE_MS / 2);

  return io;
}
