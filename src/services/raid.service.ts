import type { RedisClient } from '@devvit/public-api';

const RAID_WINDOW_MS = 300000;
const RAID_ITEM_THRESHOLD = 5;
const RAID_UNIQUE_AUTHORS_THRESHOLD = 3;
const RAID_KEY = (subredditId: string) => `sentinel:raid:${subredditId}`;
const RAID_META_KEY = (subredditId: string) => `sentinel:raidmeta:${subredditId}`;

export interface RaidAlert {
  id: string;
  subredditId: string;
  detectedAt: number;
  itemCount: number;
  uniqueAuthors: number;
  categories: string[];
  severity: 'critical' | 'high' | 'medium';
  status: 'active' | 'resolved' | 'false_alarm';
  resolvedBy?: string;
}

export async function recordSubmission(
  redis: RedisClient,
  subredditId: string,
  itemId: string,
  authorName: string,
  category: string,
): Promise<RaidAlert | null> {
  const now = Date.now();
  const key = RAID_KEY(subredditId);
  const cutoff = now - RAID_WINDOW_MS;

  await redis.zAdd(key, { score: now, member: `${now}_${itemId}_${authorName}_${category}` });
  await redis.zRemRangeByScore(key, 0, cutoff);

  const recent = await redis.zRange(key, 0, -1, { by: 'rank' });
  if (!recent || recent.length < RAID_ITEM_THRESHOLD) return null;

  const authors = new Set<string>();
  const categories = new Set<string>();
  for (const entry of recent) {
    const parts = (typeof entry === 'string' ? entry : entry.member).split('_');
    if (parts.length >= 4) {
      authors.add(parts[2]);
      categories.add(parts[3]);
    }
  }

  if (authors.size < RAID_UNIQUE_AUTHORS_THRESHOLD) return null;

  const alert: RaidAlert = {
    id: `raid-${now}`,
    subredditId,
    detectedAt: now,
    itemCount: recent.length,
    uniqueAuthors: authors.size,
    categories: Array.from(categories),
    severity: recent.length >= 15 ? 'critical' : recent.length >= 10 ? 'high' : 'medium',
    status: 'active',
  };

  await redis.set(RAID_META_KEY(subredditId), JSON.stringify(alert));
  return alert;
}

export async function getActiveRaidAlert(
  redis: RedisClient,
  subredditId: string,
): Promise<RaidAlert | null> {
  const raw = await redis.get(RAID_META_KEY(subredditId));
  if (!raw) return null;
  const alert = JSON.parse(raw) as RaidAlert;
  if (alert.status !== 'active') return null;
  if (Date.now() - alert.detectedAt > RAID_WINDOW_MS * 2) {
    await redis.del(RAID_META_KEY(subredditId));
    return null;
  }
  return alert;
}

export async function resolveRaidAlert(
  redis: RedisClient,
  subredditId: string,
  resolvedBy: string,
): Promise<void> {
  const raw = await redis.get(RAID_META_KEY(subredditId));
  if (!raw) return;
  const alert = JSON.parse(raw) as RaidAlert;
  alert.status = 'resolved';
  alert.resolvedBy = resolvedBy;
  await redis.set(RAID_META_KEY(subredditId), JSON.stringify(alert));
  await redis.del(RAID_KEY(subredditId));
}
