import { expect, test } from "bun:test"
import { COUNTS_TTL_MS, createCountsCache, unavailableCounts, type CountsResult } from "../src/cache.ts"
import { COVERAGE, WINDOW_MS } from "../src/ranking.ts"

const initial = 2_000_000_000_000
const skills = [{ id: "alpha", name: "Alpha", description: "Synthetic" }]
const good = (now: number, count = 1): CountsResult => ({ status: "ready", counts: [["alpha", count], ["beta", 7]],
  since: now - WINDOW_MS, until: now, coverage: COVERAGE, error: null })
const settled = () => Bun.sleep(0)

function fixture(maxSources?: number) {
  let now = initial
  const requests: { path: string; now: number; result: ReturnType<typeof Promise.withResolvers<CountsResult>> }[] = []
  const cache = createCountsCache((path, now) => {
    const result = Promise.withResolvers<CountsResult>()
    requests.push({ path, now, result })
    return result.promise
  }, { clock: () => now, source: path => path, maxSources })
  return { cache, requests, time: (value: number) => { now = value } }
}

test("cold concurrent reads singleflight; warm hits perform exactly one expensive query", async () => {
  const f = fixture()
  const first = f.cache.ranking("/synthetic/a", skills)
  const second = f.cache.ranking("/synthetic/a", skills)
  await settled()
  expect(f.requests).toHaveLength(1)
  f.requests[0]!.result.resolve(good(initial))
  expect((await first).items[0]!.count).toBe(1)
  expect(await second).toEqual(await first)
  const warm = await f.cache.ranking("/synthetic/a", skills)
  expect(warm).toMatchObject({ status: "ready", stale: false, refreshInProgress: false, until: initial })
  expect(f.requests).toHaveLength(1)
})

test("TTL boundary returns last-good immediately with one background refresh, then adopts updated counts", async () => {
  const f = fixture()
  const cold = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[0]!.result.resolve(good(initial))
  await cold
  f.time(initial + COUNTS_TTL_MS - 1)
  expect((await f.cache.ranking("/synthetic/a", skills)).stale).toBe(false)
  expect(f.requests).toHaveLength(1)
  f.time(initial + COUNTS_TTL_MS)
  const stale = await f.cache.ranking("/synthetic/a", skills)
  expect(stale).toMatchObject({ stale: true, refreshInProgress: true, since: initial - WINDOW_MS, until: initial })
  expect((await f.cache.ranking("/synthetic/a", skills)).items[0]!.count).toBe(1)
  expect(f.requests).toHaveLength(2)
  f.requests[1]!.result.resolve(good(initial + COUNTS_TTL_MS, 9))
  await settled()
  const updated = await f.cache.ranking("/synthetic/a", skills)
  expect(updated).toMatchObject({ stale: false, refreshInProgress: false, until: initial + COUNTS_TTL_MS })
  expect(updated.items[0]!.count).toBe(9)
  expect(updated.since).toBe(initial + COUNTS_TTL_MS - WINDOW_MS)
  expect(f.requests).toHaveLength(2)
})

test("fresh registry metadata and different location skills join cached historical IDs without SQL", async () => {
  const f = fixture()
  const cold = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[0]!.result.resolve(good(initial))
  await cold
  const changed = [{ id: "beta", name: "Renamed", description: "Fresh registry" },
    { id: "new", name: "New", description: "Added" }]
  const result = await f.cache.ranking("/synthetic/a", changed)
  expect(result.items).toEqual([{ ...changed[1]!, count: 0 }, { ...changed[0]!, count: 7 }])
  expect((await f.cache.ranking("/synthetic/a", [])).items).toEqual([])
  expect(f.requests).toHaveLength(1)
})

test("path switches cannot borrow another source's counts", async () => {
  const f = fixture()
  const a = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[0]!.result.resolve(good(initial, 3))
  await a
  const b = f.cache.ranking("/synthetic/b", skills)
  await settled()
  expect(f.requests[1]!.path).toBe("/synthetic/b")
  f.requests[1]!.result.resolve(unavailableCounts(initial, "History database missing"))
  expect(await b).toMatchObject({ status: "unavailable", items: [] })
  expect((await f.cache.ranking("/synthetic/a", skills)).items[0]!.count).toBe(3)
})

test("cold failure never caches fake zeroes; retry backoff allows recovery", async () => {
  const f = fixture()
  const cold = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[0]!.result.reject(new Error("SYNTHETIC_PRIVATE_ERROR"))
  expect(await cold).toMatchObject({ status: "unavailable", items: [], error: "History query unavailable" })
  expect(await f.cache.ranking("/synthetic/a", skills)).toEqual(await cold)
  expect(f.requests).toHaveLength(1)
  f.time(initial + 5_000)
  const retry = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[1]!.result.resolve(good(initial + 5_000, 0))
  expect((await retry).items[0]!.count).toBe(0)
  expect((await retry).status).toBe("ready")
})

test("background failures retain honest last-good provenance and bounded exponential retry", async () => {
  const f = fixture()
  const cold = f.cache.ranking("/synthetic/a", skills)
  await settled()
  f.requests[0]!.result.resolve(good(initial, 4))
  await cold
  let now = initial + COUNTS_TTL_MS
  f.time(now)
  for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    const stale = await f.cache.ranking("/synthetic/a", skills)
    expect(stale.refreshInProgress).toBe(true)
    f.requests.at(-1)!.result.resolve(unavailableCounts(now, "History schema unsupported"))
    await settled()
    const failed = await f.cache.ranking("/synthetic/a", skills)
    expect(failed).toMatchObject({ status: "ready", stale: true, refreshInProgress: false,
      since: initial - WINDOW_MS, until: initial, error: "History schema unsupported" })
    expect(failed.items[0]!.count).toBe(4)
    const count = f.requests.length
    f.time(now + delay - 1)
    await f.cache.ranking("/synthetic/a", skills)
    expect(f.requests).toHaveLength(count)
    now += delay
    f.time(now)
  }
})

test("LRU and idle cleanup bound sources without evicting pending workers", async () => {
  const f = fixture(2)
  for (const path of ["/synthetic/a", "/synthetic/b"]) {
    const cold = f.cache.ranking(path, skills)
    await settled()
    f.requests.at(-1)!.result.resolve(good(initial))
    await cold
    f.time(initial + f.requests.length)
  }
  const c = f.cache.ranking("/synthetic/c", skills)
  await settled()
  f.requests.at(-1)!.result.resolve(good(initial + 2))
  await c
  const a = f.cache.ranking("/synthetic/a", skills)
  await settled()
  expect(f.requests).toHaveLength(4)
  f.requests.at(-1)!.result.resolve(good(initial + 2))
  await a
  f.time(initial + 10 * 60_000 + 3)
  const idle = f.cache.ranking("/synthetic/a", skills)
  await settled()
  expect(f.requests).toHaveLength(5)
  f.requests.at(-1)!.result.resolve(good(initial + 10 * 60_000 + 3))
  expect((await idle).refreshInProgress).toBe(false)
  const bounded = fixture(1)
  const pending = bounded.cache.ranking("/synthetic/a", skills)
  await settled()
  expect((await bounded.cache.ranking("/synthetic/b", skills)).status).toBe("unavailable")
  expect(bounded.requests).toHaveLength(1)
  bounded.requests[0]!.result.resolve(good(initial))
  await pending
})

test("source resolver rechecks missing paths even on a warm hit", async () => {
  let missing = false
  let queries = 0
  const cache = createCountsCache(async (_path, now) => { queries++; return good(now) }, {
    source: path => { if (missing) throw new Error("missing"); return path },
  })
  await cache.ranking("/synthetic/a", skills)
  missing = true
  expect(await cache.ranking("/synthetic/a", skills)).toMatchObject({ status: "unavailable", items: [],
    error: "History database missing" })
  expect(queries).toBe(1)
})

test("aliases of the same actual database share one historical counts snapshot", async () => {
  let queries = 0
  const cache = createCountsCache(async (_path, now) => { queries++; return good(now) }, { source: () => "/synthetic/actual" })
  await cache.ranking("/synthetic/link", skills)
  await cache.ranking("/synthetic/actual", skills)
  expect(queries).toBe(1)
})
