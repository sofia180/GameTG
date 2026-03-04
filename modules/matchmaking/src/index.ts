export type MatchmakingKey = string;

export interface MatchmakingEntry {
  roomId?: string;
  userId: string;
  socketId: string;
  stake: number;
  gameType: string;
  createdAt: number;
}

type QueuedEntry = MatchmakingEntry & { expiresAt: number };

const pctDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(a || 1, b || 1);

/**
 * In-memory matchmaking with expiry, stake tolerance and group collection.
 * Keeps logic deterministic for server-authoritative matching.
 */
export interface MatchmakingStore {
  enqueue(key: MatchmakingKey, entry: QueuedEntry): Promise<void> | void;
  dequeueFirst(key: MatchmakingKey): Promise<QueuedEntry | null> | QueuedEntry | null;
  dequeueUpTo(key: MatchmakingKey, n: number): Promise<QueuedEntry[]> | QueuedEntry[];
  listKeys(): Promise<MatchmakingKey[]> | MatchmakingKey[];
  list(key: MatchmakingKey): Promise<QueuedEntry[]> | QueuedEntry[];
  cleanup(ttlMs: number): Promise<void> | void;
  size(key: MatchmakingKey): Promise<number> | number;
}

class InMemoryStore implements MatchmakingStore {
  private queue = new Map<MatchmakingKey, QueuedEntry[]>();

  enqueue(key: MatchmakingKey, entry: QueuedEntry) {
    const list = this.queue.get(key) ?? [];
    list.push(entry);
    this.queue.set(key, list);
  }

  dequeueFirst(key: MatchmakingKey) {
    const list = this.queue.get(key);
    if (!list || list.length === 0) return null;
    const first = list.shift()!;
    if (list.length === 0) this.queue.delete(key);
    else this.queue.set(key, list);
    return first;
  }

  dequeueUpTo(key: MatchmakingKey, n: number) {
    const list = this.queue.get(key) ?? [];
    const items = list.splice(0, n);
    if (list.length === 0) this.queue.delete(key);
    else this.queue.set(key, list);
    return items;
  }

  listKeys() {
    return Array.from(this.queue.keys());
  }

  list(key: MatchmakingKey) {
    return this.queue.get(key) ?? [];
  }

  cleanup(ttlMs: number) {
    const now = Date.now();
    for (const key of this.listKeys()) {
      const list = this.list(key).filter((i) => i.expiresAt > now - ttlMs);
      if (list.length === 0) this.queue.delete(key);
      else this.queue.set(key, list);
    }
  }

  size(key: MatchmakingKey) {
    return this.queue.get(key)?.length ?? 0;
  }
}

// Optional Redis-backed store (requires ioredis at runtime). If not present, creation will throw.
export class RedisMatchmakingStore implements MatchmakingStore {
  private client: any;
  constructor(url: string) {
    // dynamic require to avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require("ioredis");
    this.client = new Redis(url, { lazyConnect: false });
  }

  private keyName(key: MatchmakingKey) {
    return `mmq:${key}`;
  }

  async enqueue(key: MatchmakingKey, entry: QueuedEntry) {
    await this.client.rpush(this.keyName(key), JSON.stringify(entry));
  }

  async dequeueFirst(key: MatchmakingKey) {
    const raw = await this.client.lpop(this.keyName(key));
    return raw ? (JSON.parse(raw) as QueuedEntry) : null;
  }

  async dequeueUpTo(key: MatchmakingKey, n: number) {
    const items: QueuedEntry[] = [];
    for (let i = 0; i < n; i++) {
      const raw = await this.client.lpop(this.keyName(key));
      if (!raw) break;
      items.push(JSON.parse(raw));
    }
    return items;
  }

  async listKeys() {
    const keys: string[] = await this.client.keys("mmq:*");
    return keys.map((k) => k.replace("mmq:", ""));
  }

  async list(key: MatchmakingKey) {
    const raw = await this.client.lrange(this.keyName(key), 0, -1);
    return raw.map((r: string) => JSON.parse(r) as QueuedEntry);
  }

  async cleanup(ttlMs: number) {
    const now = Date.now();
    for (const key of await this.listKeys()) {
      const list = await this.list(key);
      const kept = list.filter((i) => i.expiresAt > now - ttlMs);
      await this.client.del(this.keyName(key));
      if (kept.length) {
        await this.client.rpush(this.keyName(key), ...kept.map((i) => JSON.stringify(i)));
      }
    }
  }

  async size(key: MatchmakingKey) {
    return this.client.llen(this.keyName(key));
  }
}

export class MatchmakingService {
  private matchedCount = 0;
  constructor(private ttlMs = 45_000, private tolerancePct = 0.05, private store: MatchmakingStore = new InMemoryStore()) {}

  private makeKey(gameType: string, stake: number) {
    return `${gameType}:${stake}`;
  }

  private async cleanup(key?: MatchmakingKey) {
    await this.store.cleanup(this.ttlMs);
    if (!key) return;
    const list = await this.store.list(key);
    const now = Date.now();
    const next = list.filter((item) => item.expiresAt > now);
    if (next.length === list.length) return;
    // rewrite via enqueue
    // reset existing
    (this.store as any).queue?.set?.(key, next);
  }

  enqueue(entry: MatchmakingEntry) {
    const key = this.makeKey(entry.gameType, entry.stake);
    this.cleanup(key);
    const expiresAt = Date.now() + this.ttlMs;
    this.store.enqueue(key, { ...entry, expiresAt });
  }

  /**
   * Dequeue the closest opponent for 1v1 games.
   */
  dequeueMatch(gameType: string, stake: number, tolerancePct = this.tolerancePct): MatchmakingEntry | null {
    this.cleanup();
    let best: { key: string; entry: QueuedEntry; diff: number } | null = null;
    for (const key of this.store.listKeys()) {
      const [gt, rawStake] = key.split(":");
      if (gt !== gameType) continue;
      const list = this.store.list(key) as QueuedEntry[];
      if (!list.length) continue;
      const listStake = Number(rawStake);
      const diff = pctDiff(listStake, stake);
      if (diff > tolerancePct) continue;
      const candidate = list[0];
      if (!best || diff < best.diff) best = { key, entry: candidate, diff };
    }
    if (!best) return null;
    const dequeued = this.store.dequeueFirst(best.key);
    if (!dequeued) return null;
    const { expiresAt, ...entry } = dequeued;
    this.matchedCount += 1;
    return entry;
  }

  /**
   * Collect a group (used for multiplayer titles like Mafia).
   * Returns null when minimum size is not met.
   */
  dequeueGroup(params: { gameType: string; stake: number; min: number; max: number; tolerancePct?: number }) {
    const tolerancePct = params.tolerancePct ?? this.tolerancePct;
    this.cleanup();
    const collected: QueuedEntry[] = [];
    for (const key of this.store.listKeys()) {
      const [gt, rawStake] = key.split(":");
      if (gt !== params.gameType) continue;
      const list = this.store.list(key) as QueuedEntry[];
      if (!list.length) continue;
      const listStake = Number(rawStake);
      if (pctDiff(listStake, params.stake) > tolerancePct) continue;

      const take = Math.min(params.max - collected.length, list.length);
      const items = this.store.dequeueUpTo(key, take) as QueuedEntry[];
      collected.push(...items);
      if (collected.length >= params.max) break;
    }

    if (collected.length < params.min) {
      // Push back to queues to keep wait order if not enough players yet
      collected.forEach((entry) => this.enqueue(entry));
      return null;
    }

    this.matchedCount += collected.length;
    return collected.map(({ expiresAt, ...entry }) => entry);
  }

  removeBySocket(socketId: string) {
    for (const key of this.store.listKeys()) {
      const list = this.store.list(key) as QueuedEntry[];
      const next = list.filter((item) => item.socketId !== socketId);
      // rewrite
      (this.store as any).queue?.set?.(key, next);
    }
  }

  snapshot() {
    this.cleanup();
    const entries: MatchmakingEntry[] = [];
    for (const key of this.store.listKeys()) {
      const list = this.store.list(key) as QueuedEntry[];
      entries.push(...list.map(({ expiresAt, ...entry }) => entry));
    }
    return entries;
  }

  stats() {
    this.cleanup();
    const keys = this.store.listKeys();
    const sizes = keys.map((k) => ({ key: k, size: this.store.size(k) }));
    return {
      keys,
      sizes,
      totalQueued: sizes.reduce((s, k) => s + k.size, 0),
      matchedCount: this.matchedCount
    };
  }
}
