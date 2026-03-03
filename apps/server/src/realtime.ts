import type { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { MatchmakingService } from "@modules/matchmaking";
import { WalletService } from "@modules/wallet";
import { computePlatformFee, computeReferralRewardFromFee } from "@modules/referral";
import { createGameEngine, type GameType, type PlayerId } from "./games/registry";
import { verifyJwt } from "./auth/jwt";

interface RoomSession {
  roomId: string;
  roomCode: string;
  gameType: GameType;
  stake: number;
  status: "waiting" | "active" | "finished";
  isPrivate: boolean;
  player1: { userId: string; socketId: string };
  player2?: { userId: string; socketId: string };
  engine: ReturnType<typeof createGameEngine> | null;
  waitTimer?: NodeJS.Timeout;
}

const generateRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const WAIT_TIMEOUT_MS = 60_000; // 60s waiting room timeout

const deepClone = <T>(data: T): T => JSON.parse(JSON.stringify(data));

function sanitizeState(gameType: GameType, state: any, viewer: PlayerId) {
  if (gameType !== "battleship") return state;
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

  const ensureAuthed = (socket: any) => {
    if (!socket.data.userId) throw new Error("Unauthenticated");
  };

  const emitState = (session: RoomSession, event: string, payload: Record<string, unknown>) => {
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
    session.engine = createGameEngine(session.gameType);
    session.status = "active";

    await prisma.gameRoom.update({
      where: { id: session.roomId },
      data: { status: "active" }
    });

    emitState(session, "start_game", {
      roomId: session.roomId,
      gameType: session.gameType,
      stake: session.stake,
      state: session.engine.state
    });
  };

  const endGame = async (session: RoomSession, winner: PlayerId | null, reason: string) => {
    if (session.status === "finished") return;
    session.status = "finished";

    const player1Id = session.player1.userId;
    const player2Id = session.player2?.userId;

    let winnerId: string | null = null;
    if (winner === "p1") winnerId = player1Id;
    if (winner === "p2") winnerId = player2Id ?? null;

    await prisma.gameRoom.update({
      where: { id: session.roomId },
      data: {
        status: winnerId ? "finished" : "cancelled",
        winnerId
      }
    });

    if (!winnerId || !player2Id) {
      await walletService.refundBet(player1Id, session.stake, { roomId: session.roomId, reason });
      if (player2Id) {
        await walletService.refundBet(player2Id, session.stake, { roomId: session.roomId, reason });
      }
      io.to(session.roomId).emit("game_end", { winner: null, reason });
      return;
    }

    const totalPot = session.stake * 2;
    const fee = computePlatformFee(totalPot, feeBps);
    const referralReward = computeReferralRewardFromFee(fee, referralShare);
    const payout = totalPot - fee;

    await walletService.settleWin(winnerId, payout, { roomId: session.roomId, fee });

    const players = await prisma.user.findMany({
      where: { id: { in: [player1Id, player2Id] } },
      select: { id: true, referredById: true }
    });
    const referrals = players.map((p) => p.referredById).filter((id): id is string => !!id);

    if (referrals.length > 0) {
      const perReferrer = Number((referralReward / referrals.length).toFixed(8));
      for (const referrerId of referrals) {
        await prisma.referralReward.create({
          data: { referrerId, userId: winnerId, amount: perReferrer }
        });
        await walletService.deposit(referrerId, perReferrer, {
          source: "referral",
          roomId: session.roomId
        });
      }
    }

    io.to(session.roomId).emit("game_end", {
      winner: winnerId,
      payout,
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

    await walletService.lockForBet(userId, stake, { gameType, roomCode });

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

    const session: RoomSession = {
      roomId: room.id,
      roomCode,
      gameType,
      stake,
      status: "waiting",
      isPrivate,
      player1: { userId, socketId: socket.id },
      engine: null
    };

    // auto-timeout waiting room to avoid stuck locked stakes
    session.waitTimer = setTimeout(async () => {
      if (session.status !== "waiting") return;
      await endGame(session, null, "timeout_waiting");
    }, 60_000);

    sessions.set(room.id, session);
    sessionsByCode.set(roomCode, session);
    socket.join(room.id);

    socket.emit("room_created", { roomId: room.id, roomCode, isPrivate });
    if (!isPrivate) {
      matchmaking.enqueue({ roomId: room.id, userId, socketId: socket.id, stake, gameType, createdAt: Date.now() });
    }

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
      } catch {
        socket.emit("error", { message: "Invalid token" });
      }
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
        if (session.player1.userId === userId) {
          session.player1.socketId = socket.id;
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

        if (session.player2?.userId === userId) {
          session.player2.socketId = socket.id;
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

        if (session.player2) throw new Error("Room is full");

        await walletService.lockForBet(userId, session.stake, { gameType: session.gameType, roomCode: session.roomCode });
        session.player2 = { userId, socketId: socket.id };

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
        const match = matchmaking.dequeueMatch(gameType, stake);
        if (!match) {
          await createRoomForUser({ socket, userId, gameType, stake, isPrivate: false });
          socket.emit("match_waiting", { gameType, stake });
          return;
        }

        const session = sessions.get(match.roomId);
        if (!session) throw new Error("Room expired");
        if (session.player1.userId === userId) throw new Error("Cannot join your own room");

        await walletService.lockForBet(userId, stake, { gameType, roomCode: session.roomCode });
        session.player2 = { userId, socketId: socket.id };

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
        socket.emit("error", { message: error.message ?? "Failed to join random" });
      }
    });

    socket.on("move", async ({ roomId, move }: { roomId: string; move: unknown }) => {
      try {
        ensureAuthed(socket);
        const session = sessions.get(roomId);
        if (!session || !session.engine) throw new Error("Room not active");

        const userId = socket.data.userId as string;
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
          await endGame(session, result.outcome.winner ?? player, "win");
        } else if (result.outcome?.status === "draw") {
          await endGame(session, null, "draw");
        }
      } catch (error: any) {
        socket.emit("error", { message: error.message ?? "Move failed" });
      }
    });

    socket.on("disconnect", async () => {
      matchmaking.removeBySocket(socket.id);
      for (const session of sessions.values()) {
        if (session.status === "finished") continue;
        const isPlayer1 = session.player1.socketId === socket.id;
        const isPlayer2 = session.player2?.socketId === socket.id;
        if (!isPlayer1 && !isPlayer2) continue;
        if (session.status === "waiting") {
          await endGame(session, null, "disconnect");
        } else {
          const winner: PlayerId = isPlayer1 ? "p2" : "p1";
          await endGame(session, winner, "disconnect");
        }
      }
    });
  });

  return io;
}
