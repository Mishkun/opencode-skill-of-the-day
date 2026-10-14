import { readRanking } from "./database.ts"
import type { AvailableSkill } from "./ranking.ts"

self.onmessage = (event: MessageEvent<{ path: string; available: AvailableSkill[]; now: number }>) => {
  const { path, available, now } = event.data
  self.postMessage(readRanking(path, available, now))
}
