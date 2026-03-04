# Deployment Guide (Server + Web + Metrics)

## Prerequisites
- Node.js + pnpm
- PostgreSQL
- Redis (optional, recommended for matchmaking)
- Prometheus (optional, for alerts) and Grafana

## Environment
- `DATABASE_URL` — Postgres
- `PORT` — server port
- `JWT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `FRONTEND_URL`
- `ADMIN_API_KEY`
- `PLATFORM_FEE_BPS` (default 1000 = 10%)
- `REFERRAL_SHARE`
- `WITHDRAW_DAILY_LIMIT`
- `WITHDRAW_REVIEW_THRESHOLD` (USD amount to auto-send withdrawals to review)
- `WIN_REVIEW_THRESHOLD` (large wins go to review/hold)
- `REDIS_URL` (enable Redis matchmaking)
- `BLOCKED_IPS` (comma-separated)
- `BAD_IP_REPUTATION` (comma-separated)
- `FLASH_CUP_INTERVAL_MINUTES`, `FLASH_CUP_ENTRY`, `FLASH_CUP_PRIZE`
- `INVITE_KEY_REWARD`, `TEAM_QUEST_REWARD`, `DUO_BONUS_REWARD`

Web:
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SOCKET_URL`
- `NEXT_PUBLIC_WEB_URL`
- `NEXT_PUBLIC_TELEGRAM_BOT`

## Steps
1) Install deps: `pnpm install`
2) Migrate DB: `pnpm --filter server prisma migrate deploy`
3) Build:  
   - `pnpm --filter server build` (if build script added) or run ts-node in prod env.  
   - `pnpm --filter web build`
4) Start:  
   - Server: `pnpm --filter server start` (ensure `PORT`, `DATABASE_URL`, `REDIS_URL` etc. set)  
   - Web: `pnpm --filter web start`

## Redis matchmaking
Set `REDIS_URL`. Falls back to in-memory if unavailable. Prometheus metrics exposed at `/metrics`.

## Prometheus scrape example
```
- job_name: 'gametg'
  static_configs:
    - targets: ['server-host:4000']
  metrics_path: /metrics
```

## Alert ideas (PromQL)
- Queue backlog: `gametg_matchmaking_queue > 50`
- Heartbeat drop proxy (use socket disconnect logs exported as counter): `rate(gametg_disconnects_total[5m]) > 10`
- Deposits in review: `gametg_deposits_review` (add via recording rule on transactions with status=review)

## Grafana
Add Prometheus as data source, import basic dashboard with the metrics above. Configure alerts routing via Alertmanager.
