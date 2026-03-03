import type { PrismaClient } from "@prisma/client";
import { TournamentStatus } from "@prisma/client";
import { WalletService } from "@modules/wallet";

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

  async reportMatch(tournamentId: string, matchId: string, winnerId: string, payload?: any) {
    const match = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { winnerId, report: payload || {}, updatedAt: new Date() }
    });

    // simplistic: if this is final match, pay winner total prizePool
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new Error("Tournament missing");

    const isFinal = (await this.prisma.tournamentMatch.count({ where: { tournamentId, winnerId: null } })) === 0;
    if (isFinal) {
      const totalPot = Number(t.prizePool || 0);
      if (totalPot > 0) {
        await this.wallet.settleWin(winnerId, totalPot, { tournamentId, matchId, type: "tournament" });
      }
      await this.prisma.tournament.update({ where: { id: tournamentId }, data: { status: TournamentStatus.completed } });
    }

    return match;
  }
}

