import { isRankingResult, type AvailableSkill, type RankingResult } from "./ranking.ts"

/** SQLite work stays off the server event loop. Never logs worker errors or payloads. */
export function queryRanking(path: string, available: AvailableSkill[], now: number, signal?: AbortSignal): Promise<RankingResult> {
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
      if (!isRankingResult(event.data)) return fail()
      stop()
      resolve(event.data)
    }
    worker.onerror = event => { event.preventDefault(); fail() }
    signal?.addEventListener("abort", cancel, { once: true })
    worker.postMessage({ path, available, now })
  })
}
