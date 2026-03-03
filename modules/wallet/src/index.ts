import type { PrismaClient } from "@prisma/client";

export class WalletService {
  constructor(private prisma: PrismaClient) {}

  async getOrCreateWallet(userId: string) {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { userId, balance: 0 } });
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return Number(wallet.balance);
  }

  async deposit(userId: string, amount: number, metadata?: Record<string, unknown>) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: { balance: { increment: amount } },
        create: { userId, balance: amount }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "deposit",
          amount,
          status: "completed",
          metadata
        }
      });

      return { wallet, transaction };
    });
  }

  async lockForBet(userId: string, amount: number, metadata?: Record<string, unknown>) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || Number(wallet.balance) < amount) {
        throw new Error("Insufficient balance");
      }

      // prevent double-lock with same reference
      const refId = metadata && (metadata as any).roomId ? `bet:${(metadata as any).roomId}:${userId}` : undefined;
      if (refId) {
        const existing = await tx.transaction.findUnique({ where: { referenceId: refId } });
        if (existing) return { wallet, transaction: existing };
      }

      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "bet",
          amount,
          status: "locked",
          metadata,
          referenceId: refId
        }
      });

      return { wallet: updated, transaction };
    });
  }

  async refundBet(userId: string, amount: number, metadata?: Record<string, unknown>) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "bet",
          amount,
          status: "refunded",
          metadata
        }
      });

      return { wallet, transaction };
    });
  }

  async settleWin(userId: string, amount: number, metadata?: Record<string, unknown>) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      const refId = metadata && (metadata as any).roomId ? `win:${(metadata as any).roomId}:${userId}` : undefined;
      if (refId) {
        const existing = await tx.transaction.findUnique({ where: { referenceId: refId } });
        if (existing) return { wallet: await tx.wallet.findUnique({ where: { userId } }), transaction: existing };
      }

      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "win",
          amount,
          status: "completed",
          metadata,
          referenceId: refId
        }
      });

      return { wallet, transaction };
    });
  }

  async requestWithdraw(userId: string, amount: number, metadata?: Record<string, unknown>) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || Number(wallet.balance) < amount) {
        throw new Error("Insufficient balance");
      }

      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "withdraw",
          amount,
          status: "pending",
          metadata
        }
      });

      return { wallet: updated, transaction };
    });
  }
}
