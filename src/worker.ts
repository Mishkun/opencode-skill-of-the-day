import { rankSkills, type AvailableSkill, type RankingResult } from "./ranking.ts"
import { isCountsResult, type CountsResult } from "./cache.ts"

/** SQLite work stays off the server event loop. Never logs worker errors or payloads. */
export function queryCounts(path: string, now: number, signal?: AbortSignal): Promise<CountsResult> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const worker = new Worker(new URL("./ranking-worker.ts", import.meta.url).href)
    const stop = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", cancel)
      worker.terminate()
    }
    const fail = () => { stop(); reject(new Error("Ranking worker unavailable")) }
    const cancel = () => { stop(); reject(new Error("Ranking cancelled")) }
    const timeout = setTimeout(fail, 30_000)
    worker.onmessage = event => {
      if (!isCountsResult(event.data)) return fail()
      stop()
      resolve(event.data)
    }
    worker.onerror = event => { event.preventDefault(); fail() }
    signal?.addEventListener("abort", cancel, { once: true })
    worker.postMessage({ path, now })
  })
}

export async function queryRanking(path: string, available: AvailableSkill[], now: number, signal?: AbortSignal): Promise<RankingResult> {
  const { counts, ...result } = await queryCounts(path, now, signal)
  return { ...result, items: result.status === "ready" ? rankSkills(available, new Map(counts)) : [] }
}
