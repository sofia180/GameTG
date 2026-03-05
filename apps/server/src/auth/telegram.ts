import crypto from "crypto";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface TelegramInitData {
  user?: TelegramUser;
  auth_date?: string;
  query_id?: string;
  hash?: string;
  start_param?: string;
}

export function parseInitData(initData: string): TelegramInitData {
  const params = new URLSearchParams(initData);
  const data: TelegramInitData = {};
  for (const [key, value] of params.entries()) {
    if (key === "user") {
      try {
        data.user = JSON.parse(value);
      } catch {
        // ignore parse errors
      }
    } else if (key === "hash") {
      data.hash = value;
    } else if (key === "auth_date") {
      data.auth_date = value;
    } else if (key === "query_id") {
      data.query_id = value;
    } else if (key === "start_param") {
      data.start_param = value;
    } else {
      (data as Record<string, string>)[key] = value;
    }
  }
  return data;
}

export function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;

  // Check freshness (avoid replay). Telegram suggests 86400s; we allow 24h to avoid WebApp cache issues.
  const authDateStr = params.get("auth_date");
  if (authDateStr) {
    const authTs = Number(authDateStr);
    const now = Math.floor(Date.now() / 1000);
    if (Number.isFinite(authTs) && now - authTs > 86400) {
      return false;
    }
  }

  params.delete("hash");
  const dataCheckArr: string[] = [];
  for (const [key, value] of params.entries()) {
    dataCheckArr.push(`${key}=${value}`);
  }
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return hmac === hash;
}
