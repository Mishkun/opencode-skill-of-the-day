import { realpathSync } from "node:fs"
import { COVERAGE, WINDOW_MS, rankSkills, type AvailableSkill, type RankingResult } from "./ranking.ts"

export type CountsResult = {
  status: "ready" | "unavailable"
  counts: [string, number][]
  since: number
  until: number
  coverage: string
  error: string | null
}
export type CachedRanking = RankingResult & { stale: boolean; refreshInProgress: boolean }
export const COUNTS_TTL_MS = 60_000
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000
const IDLE_MS = 10 * 60_000
const MAX_SOURCES = 16

export function unavailableCounts(now: number, error = "History query unavailable"): CountsResult {
  return { status: "unavailable", counts: [], since: now - WINDOW_MS, until: now, coverage: COVERAGE, error }
}

export function isCountsResult(value: unknown): value is CountsResult {
  if (!value || typeof value !== "object") return false
  const r = value as CountsResult
  return (r.status === "ready" || r.status === "unavailable") &&
    Number.isSafeInteger(r.since) && Number.isSafeInteger(r.until) &&
    typeof r.coverage === "string" && (r.error === null || typeof r.error === "string") &&
    Array.isArray(r.counts) && r.counts.every(row => Array.isArray(row) && row.length === 2 &&
      typeof row[0] === "string" && Number.isSafeInteger(row[1]) && row[1] >= 0) &&
    (r.status !== "unavailable" || r.counts.length === 0)
}

type Entry = {
  good?: CountsResult
  failure?: CountsResult
  pending?: Promise<void>
  retryAt: number
  failures: number
  accessed: number
}

/** Server-module lifetime; only counts are shared, never location-specific registries. */
export function createCountsCache(
  query: (path: string, now: number) => Promise<CountsResult>,
  options: { clock?: () => number; source?: (path: string) => string; maxSources?: number } = {},
) {
  const clock = options.clock ?? Date.now
  const source = options.source ?? realpathSync
  const maxSources = options.maxSources ?? MAX_SOURCES
  const entries = new Map<string, Entry>()

  function refresh(path: string, entry: Entry, now: number) {
    // Schedule before invoking the loader so even simultaneous cold reads singleflight.
    entry.pending = Promise.resolve().then(() => query(path, now)).then(result => {
      if (!isCountsResult(result)) throw new Error("Invalid counts response")
      if (result.status === "ready") {
        entry.good = result
        entry.failure = undefined
        entry.failures = 0
        entry.retryAt = 0
      } else failed(result)
    }).catch(() => failed(unavailableCounts(now))).finally(() => { entry.pending = undefined })
    function failed(result: CountsResult) {
      entry.failure = result
      entry.failures++
      entry.retryAt = clock() + Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(entry.failures - 1, 4))
    }
  }

  return {
    async ranking(path: string, available: readonly AvailableSkill[]): Promise<CachedRanking> {
      const now = clock()
      const join = (result: CountsResult, stale = false, refreshInProgress = false): CachedRanking => {
        const { counts, ...metadata } = result
        return { ...metadata, items: result.status === "ready" ? rankSkills(available, new Map(counts)) : [],
          stale, refreshInProgress }
      }
      // Recheck the source even on a warm hit: removed/missing paths cannot borrow last-good counts.
      let key: string
      try { key = source(path) } catch { return join(unavailableCounts(now, "History database missing")) }
      for (const [key, entry] of entries) {
        if (!entry.pending && now - entry.accessed >= IDLE_MS) entries.delete(key)
      }
      let entry = entries.get(key)
      if (!entry) {
        if (entries.size >= maxSources) {
          const oldest = [...entries].filter(([, e]) => !e.pending).sort((a, b) => a[1].accessed - b[1].accessed)[0]
          if (!oldest) return join(unavailableCounts(now))
          entries.delete(oldest[0])
        }
        entry = { retryAt: 0, failures: 0, accessed: now }
        entries.set(key, entry)
      }
      entry.accessed = now
      const stale = !entry.good || now - entry.good.until >= COUNTS_TTL_MS
      if (stale && !entry.pending && now >= entry.retryAt) refresh(key, entry, now)
      // Cold reads await one shared worker; stale reads never await SQLite.
      if (!entry.good && entry.pending) await entry.pending
      if (!entry.good) return join(entry.failure ?? unavailableCounts(now))
      return join({ ...entry.good, error: entry.failure?.error ?? null },
        clock() - entry.good.until >= COUNTS_TTL_MS, !!entry.pending)
    },
  }
}
