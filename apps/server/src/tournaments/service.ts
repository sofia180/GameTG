import type { PrismaClient } from "@prisma/client";
import { WalletService } from "@modules/wallet";

const TournamentStatus = {
  draft: "draft",
  active: "active",
  completed: "completed",
  cancelled: "cancelled"
} as const;

type Participant = { userId: string };

export class TournamentService {
  constructor(private prisma: PrismaClient, private wallet: WalletService) {}

  async list() {
    return this.prisma.tournament.findMany({ orderBy: { createdAt: "desc" } });
  }

  async get(id: string) {
    return this.prisma.tournament.findUnique({ where: { id }, include: { participants: true, matches: true } });
  }

  async create(params: { title: string; game: string; entryFee: number; prizePool?: number; startsAt?: Date; createdById?: string }) {
    return this.prisma.tournament.create({
      data: {
        title: params.title,
        game: params.game,
        entryFee: params.entryFee,
        prizePool: params.prizePool ?? params.entryFee * 16,
        startsAt: params.startsAt,
        createdById: params.createdById,
        status: TournamentStatus.active
      }
    });
  }

  async join(id: string, userId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new Error("Tournament not found");
    if (t.status !== TournamentStatus.active) throw new Error("Tournament not active");

    await this.wallet.lockForBet(userId, Number(t.entryFee), { tournamentId: id });

    return this.prisma.tournamentParticipant.upsert({
      where: { tournamentId_userId: { tournamentId: id, userId } },
      create: { tournamentId: id, userId, paid: true },
      update: { paid: true }
    });
  }

  private bracketSize(count: number) {
    return 2 ** Math.ceil(Math.log2(Math.max(2, count)));
  }

  private chunkPairs<T>(arr: T[]): [T | undefined, T | undefined][] {
    const pairs: [T | undefined, T | undefined][] = [];
    for (let i = 0; i < arr.length; i += 2) {
      pairs.push([arr[i], arr[i + 1]]);
    }
    return pairs;
  }

  async seedBracket(tournamentId: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { participants: { where: { paid: true }, orderBy: { createdAt: "asc" } } }
    });
    if (!t) throw new Error("Tournament not found");

    const seeds: Participant[] = t.participants.map((p) => ({ userId: p.userId }));
    const size = this.bracketSize(seeds.length);
    const slots = Array.from({ length: size }, (_, i) => seeds[i]?.userId);

    const matchesCreated: any[] = [];
    let currentSlots = slots;
    let round = 1;

    while (currentSlots.length > 1) {
      const nextRound: (string | undefined)[] = [];
      for (const [idx, pair] of this.chunkPairs(currentSlots).entries()) {
        const [p1, p2] = pair;
        const match = await this.prisma.tournamentMatch.create({
          data: { tournamentId, round, player1Id: p1, player2Id: p2, externalMatchId: `${round}-${idx}` }
        });
        matchesCreated.push(match);
        if (p1 && !p2) {
          await this.prisma.tournamentMatch.update({ where: { id: match.id }, data: { winnerId: p1 } });
          nextRound.push(p1);
        } else if (!p1 && p2) {
          await this.prisma.tournamentMatch.update({ where: { id: match.id }, data: { winnerId: p2 } });
          nextRound.push(p2);
        } else {
          nextRound.push(undefined);
        }
      }
      round += 1;
      currentSlots = nextRound;
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { bracket: matchesCreated, prizePool: t.prizePool || Number(t.entryFee) * seeds.length }
    });

    const pending = await this.prisma.tournamentMatch.count({ where: { tournamentId, winnerId: null } });
    if (pending === 0 && matchesCreated.length > 0) {
      const finalMatch = matchesCreated.reduce((acc, curr) => (curr.round >= (acc?.round ?? 0) ? curr : acc), null as any);
      if (finalMatch?.winnerId) {
        await this.wallet.settleWin(finalMatch.winnerId, Number(t.prizePool || 0), { tournamentId, matchId: finalMatch.id, type: "tournament" });
        await this.prisma.tournament.update({ where: { id: tournamentId }, data: { status: TournamentStatus.completed } });
      }
    }

    return matchesCreated;
  }

  private async advanceRound(tournamentId: string, round: number) {
    const matches = await this.prisma.tournamentMatch.findMany({
      where: { tournamentId, round },
      orderBy: { createdAt: "asc" }
    });
    if (matches.some((m) => !m.winnerId)) return; // round not finished

    const winners = matches.map((m) => m.winnerId).filter(Boolean) as string[];
    if (winners.length === 0) return;

    const existingNext = await this.prisma.tournamentMatch.count({ where: { tournamentId, round: round + 1 } });
    if (existingNext > 0) return; // already seeded next

    const pairs = this.chunkPairs(winners);
    for (const [idx, [p1, p2]] of pairs.entries()) {
      const created = await this.prisma.tournamentMatch.create({
        data: { tournamentId, round: round + 1, player1Id: p1, player2Id: p2, externalMatchId: `${round + 1}-${idx}` }
      });
      if (p1 && !p2) {
        await this.prisma.tournamentMatch.update({ where: { id: created.id }, data: { winnerId: p1 } });
      }
    }
  }

  async reportMatch(tournamentId: string, matchId: string, winnerId: string, payload?: any) {
    const match = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { winnerId, report: payload || {} }
    });

    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new Error("Tournament missing");

    await this.advanceRound(tournamentId, match.round);

    const unfinished = await this.prisma.tournamentMatch.count({ where: { tournamentId, winnerId: null } });
    if (unfinished === 0) {
      const totalPot = Number(t.prizePool || 0);
      if (totalPot > 0) {
        await this.wallet.settleWin(winnerId, totalPot, { tournamentId, matchId, type: "tournament" });
      }
      await this.prisma.tournament.update({ where: { id: tournamentId }, data: { status: TournamentStatus.completed } });
    }

    return match;
  }

  async reportExternal(tournamentId: string, externalMatchId: string, winnerId: string, payload?: any) {
    const match = await this.prisma.tournamentMatch.findFirst({ where: { tournamentId, externalMatchId } });
    if (!match) throw new Error("Match not found");
    return this.reportMatch(tournamentId, match.id, winnerId, payload);
  }

  async maybeCreateFlashCup(params: { game?: string; entryFee?: number; prizePool?: number; intervalMinutes: number }) {
    const since = new Date(Date.now() - params.intervalMinutes * 60 * 1000);
    const existing = await this.prisma.tournament.findFirst({
      where: { game: params.game ?? "flash", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;
    return this.create({
      title: "Flash Cup",
      game: params.game ?? "flash",
      entryFee: params.entryFee ?? 1,
      prizePool: params.prizePool ?? 10
    });
  }
}
