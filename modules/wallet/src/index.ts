import type { PrismaClient } from "@prisma/client";

export class WalletService {
  constructor(private prisma: PrismaClient) {}

  private isIpSuspicious(ip?: string) {
    if (!ip) return false;
    const blocked = (process.env.BLOCKED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (blocked.includes(ip)) return true;
    const badRep = (process.env.BAD_IP_REPUTATION ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return badRep.includes(ip);
  }

  private isDeviceSuspicious(device?: string) {
    if (!device) return false;
    const d = device.toLowerCase();
    return d.includes("emulator") || d.includes("virtual") || d.includes("rooted");
  }

  async getOrCreateWallet(userId: string) {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { userId, balance: 0 } });
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return Number(wallet.balance);
  }

  async deposit(userId: string, amount: number, metadata?: Record<string, unknown>, referenceId?: string) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      if (referenceId) {
        const existing = await tx.transaction.findUnique({ where: { referenceId } });
        if (existing) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          return { wallet: wallet!, transaction: existing };
        }
      }
      // rudimentary risk score
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const freq = await tx.transaction.count({ where: { userId, type: "deposit", createdAt: { gte: since } } });
      const ip = (metadata as any)?.ip;
      const device = (metadata as any)?.device;
      const riskScore = amount >= 1000 ? 0.8 : amount >= 500 ? 0.5 : 0.1;
      const riskFlags = [];
      if (riskScore >= 0.8) riskFlags.push("large_deposit");
      if (freq >= 10) riskFlags.push("high_frequency");
      if (this.isIpSuspicious(ip?.toString())) riskFlags.push("suspicious_ip");
      if (this.isDeviceSuspicious(device)) riskFlags.push("emulator");

      const highRisk = riskScore >= 0.7 || riskFlags.includes("suspicious_ip") || riskFlags.includes("emulator");

      const wallet = highRisk
        ? await tx.wallet.upsert({ where: { userId }, update: {}, create: { userId, balance: 0 } })
        : await tx.wallet.upsert({ where: { userId }, update: { balance: { increment: amount } }, create: { userId, balance: amount } });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "deposit",
          amount,
          status: highRisk ? "review" : "completed",
          metadata: { ...metadata, riskScore, riskFlags },
          referenceId
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
      const refId =
        metadata && (metadata as any).roomId
          ? `bet:${(metadata as any).roomId}:${userId}`
          : metadata && (metadata as any).roomCode
            ? `bet:${(metadata as any).roomCode}:${userId}`
            : undefined;
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
      const refId =
        metadata && (metadata as any).roomId
          ? `refund:${(metadata as any).roomId}:${userId}`
          : metadata && (metadata as any).roomCode
            ? `refund:${(metadata as any).roomCode}:${userId}`
            : undefined;

      if (refId) {
        const existing = await tx.transaction.findUnique({ where: { referenceId: refId } });
        if (existing) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          return { wallet: wallet!, transaction: existing };
        }
      }

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
          metadata,
          referenceId: refId
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

      const reviewThreshold = (process.env.WIN_REVIEW_THRESHOLD && Number(process.env.WIN_REVIEW_THRESHOLD)) || Infinity;
      const audit = [{ at: new Date().toISOString(), action: "win_recorded" }];
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) wallet = await tx.wallet.create({ data: { userId, balance: 0 } });

      const inReview = amount >= reviewThreshold;
      if (!inReview) {
        wallet = await tx.wallet.update({ where: { userId }, data: { balance: { increment: amount } } });
      }

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "win",
          amount,
          status: inReview ? "review" : "completed",
          metadata: { ...metadata, audit },
          referenceId: refId
        }
      });

      return { wallet, transaction };
    });
  }

  async requestWithdraw(userId: string, amount: number, metadata?: Record<string, unknown>, referenceId?: string) {
    if (amount <= 0) throw new Error("Invalid amount");
    return this.prisma.$transaction(async (tx) => {
      if (referenceId) {
        const existing = await tx.transaction.findUnique({ where: { referenceId } });
        if (existing) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          return { wallet: wallet!, transaction: existing };
        }
      }
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || Number(wallet.balance) < amount) {
        throw new Error("Insufficient balance");
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const spentToday = await tx.transaction.aggregate({
        where: { userId, type: "withdraw", createdAt: { gte: today }, status: { in: ["pending", "completed"] } },
        _sum: { amount: true }
      });
      const limit = (process.env.WITHDRAW_DAILY_LIMIT && Number(process.env.WITHDRAW_DAILY_LIMIT)) || 0;
      if (limit && Number(spentToday._sum.amount ?? 0) + amount > limit) {
        throw new Error("Daily withdraw limit reached");
      }

      const ref = referenceId ?? `wd:${userId}:${amount}:${today.toISOString()}`;

      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } }
      });

      const reviewThreshold = (process.env.WITHDRAW_REVIEW_THRESHOLD && Number(process.env.WITHDRAW_REVIEW_THRESHOLD)) || Infinity;
      const status: any = amount >= reviewThreshold ? "review" : "pending";

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "withdraw",
          amount,
          status,
          metadata: { ...metadata, audit: [{ at: new Date().toISOString(), action: "requested" }] },
          referenceId: ref
        }
      });

      return { wallet: updated, transaction };
    });
  }

  async approveWithdraw(transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "withdraw") throw new Error("Withdraw not found");
      if (txRecord.status === "completed") return txRecord;
      if (txRecord.status === "failed") throw new Error("Cannot approve failed withdraw");
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "approved" });
      return tx.transaction.update({ where: { id: transactionId }, data: { status: "completed", metadata: { ...(txRecord.metadata as any), audit } } });
    });
  }

  async rejectWithdraw(transactionId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "withdraw") throw new Error("Withdraw not found");
      if (txRecord.status === "failed") return txRecord;
      // refund balance only if previously debited
      await tx.wallet.update({
        where: { userId: txRecord.userId },
        data: { balance: { increment: Number(txRecord.amount) } }
      });
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "rejected", reason: reason ?? "rejected" });
      return tx.transaction.update({
        where: { id: transactionId },
        data: { status: "failed", metadata: { ...(txRecord.metadata as any), reason: reason ?? "rejected", audit } }
      });
    });
  }

  async approveDeposit(transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "deposit") throw new Error("Deposit not found");
      if (txRecord.status === "completed") return txRecord;
      if (txRecord.status !== "review") throw new Error("Deposit not in review");
      await tx.wallet.update({
        where: { userId: txRecord.userId },
        data: { balance: { increment: Number(txRecord.amount) } }
      });
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "deposit_approved" });
      return tx.transaction.update({ where: { id: transactionId }, data: { status: "completed", metadata: { ...(txRecord.metadata as any), audit } } });
    });
  }

  async rejectDeposit(transactionId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "deposit") throw new Error("Deposit not found");
      if (txRecord.status === "failed") return txRecord;
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "deposit_rejected", reason: reason ?? "rejected" });
      return tx.transaction.update({ where: { id: transactionId }, data: { status: "failed", metadata: { ...(txRecord.metadata as any), audit } } });
    });
  }
  async approveWin(transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "win") throw new Error("Win not found");
      if (txRecord.status === "completed") return txRecord;
      if (txRecord.status !== "review") throw new Error("Win not in review");
      await tx.wallet.update({
        where: { userId: txRecord.userId },
        data: { balance: { increment: Number(txRecord.amount) } }
      });
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "win_approved" });
      return tx.transaction.update({ where: { id: transactionId }, data: { status: "completed", metadata: { ...(txRecord.metadata as any), audit } } });
    });
  }

  async rejectWin(transactionId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const txRecord = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!txRecord || txRecord.type !== "win") throw new Error("Win not found");
      if (txRecord.status === "failed") return txRecord;
      const audit = Array.isArray((txRecord.metadata as any)?.audit) ? (txRecord.metadata as any).audit : [];
      audit.push({ at: new Date().toISOString(), action: "win_rejected", reason: reason ?? "rejected" });
      return tx.transaction.update({ where: { id: transactionId }, data: { status: "failed", metadata: { ...(txRecord.metadata as any), audit } } });
    });
  }
}
