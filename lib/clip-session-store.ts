/**
 * Per-user serialization for clip POST so concurrent turns don't interleave
 * credits / engine / vector / vault writes. In-process only (one Node instance);
 * for multi-instance serverless use Redis or Supabase advisory locks.
 *
 * Also keeps a tiny LRU of last-known clip job id per user (reconnect hints; not authoritative).
 */

const tails = new Map<string, Promise<unknown>>();

const MAX_SESSION_ENTRIES = 1024;
/** userId -> last touched ms (for LRU eviction of session metadata only). */
const sessionTouch = new Map<string, number>();
export type ClipSessionMeta = { last_job_id: string | null };

const sessionMeta = new Map<string, ClipSessionMeta>();

function touchSession(userId: string) {
  const now = Date.now();
  sessionTouch.set(userId, now);
  while (sessionTouch.size > MAX_SESSION_ENTRIES) {
    let oldest: string | null = null;
    let oldestT = Infinity;
    for (const [uid, t] of sessionTouch) {
      if (t < oldestT) {
        oldestT = t;
        oldest = uid;
      }
    }
    if (!oldest) break;
    sessionTouch.delete(oldest);
    sessionMeta.delete(oldest);
  }
}

export function getClipSessionMeta(userId: string): ClipSessionMeta {
  touchSession(userId);
  let m = sessionMeta.get(userId);
  if (!m) {
    m = { last_job_id: null };
    sessionMeta.set(userId, m);
  }
  return m;
}

export function setClipSessionLastJob(userId: string, jobId: string) {
  touchSession(userId);
  const m = getClipSessionMeta(userId);
  m.last_job_id = jobId;
}

export async function withClipExclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  touchSession(userId);
  const prev = (tails.get(userId) as Promise<void> | undefined) ?? Promise.resolve();
  const result = prev.then(() => fn());
  tails.set(userId, result.then(() => undefined).catch(() => undefined));
  return result as Promise<T>;
}
