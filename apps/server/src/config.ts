import dotenv from "dotenv";

dotenv.config();

const required = (key: string, fallback?: string) => process.env[key] ?? fallback ?? "";

export const config = {
  port: Number(required("PORT", "4000")),
  jwtSecret: required("JWT_SECRET", "dev-secret"),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN", ""),
  frontendUrl: required("FRONTEND_URL", "http://localhost:3000"),
  adminApiKey: required("ADMIN_API_KEY", "change-me"),
  enableDevAuth: required("ENABLE_DEV_AUTH", "true") === "true",
  platformFeeBps: Number(required("PLATFORM_FEE_BPS", "1000")), // 10% default
  referralShare: Number(required("REFERRAL_SHARE", "0.1")),
  withdrawDailyLimit: Number(required("WITHDRAW_DAILY_LIMIT", "1000")), // per-user soft cap in USDT
  withdrawReviewThreshold: Number(required("WITHDRAW_REVIEW_THRESHOLD", "5000")), // withdrawals >= go to review
  winReviewThreshold: Number(required("WIN_REVIEW_THRESHOLD", "10000")), // large wins go to review
  redisUrl: process.env.REDIS_URL,
  blockedIps: (process.env.BLOCKED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  badIpReputation: (process.env.BAD_IP_REPUTATION ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  flashCupIntervalMinutes: Number(required("FLASH_CUP_INTERVAL_MINUTES", "60")),
  flashCupEntry: Number(required("FLASH_CUP_ENTRY", "1")),
  flashCupPrize: Number(required("FLASH_CUP_PRIZE", "10")),
  inviteKeyReward: Number(required("INVITE_KEY_REWARD", "0.5")),
  teamQuestReward: Number(required("TEAM_QUEST_REWARD", "1")),
  duoBonusReward: Number(required("DUO_BONUS_REWARD", "0.5"))
};
