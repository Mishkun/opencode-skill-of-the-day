import { readCounts } from "./database.ts"

self.onmessage = (event: MessageEvent<{ path: string; now: number }>) => {
  const { path, now } = event.data
  self.postMessage(readCounts(path, now))
}
