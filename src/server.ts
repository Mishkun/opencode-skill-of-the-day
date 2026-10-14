import { Plugin } from "@opencode/plugin"
import { serverDatabasePath } from "./database.ts"
import { SkillOfTheDay } from "./rpc.ts"
import { COVERAGE, WINDOW_MS } from "./ranking.ts"
import { queryCounts } from "./worker.ts"
import { createCountsCache } from "./cache.ts"

// Shared across location handlers. Disposing one RPC registration must not cancel
// another location's worker or discard its warm counts.
const countsCache = createCountsCache(queryCounts)

export default Plugin.define({
  id: "skill-of-the-day.server",
  async setup(context) {
    const registration = await context.rpc.register(SkillOfTheDay, {
      ranking: async (_input, call) => {
        call.signal.throwIfAborted()
        const now = Date.now()
        try {
          const skills = await context.skill.list()
          call.signal.throwIfAborted()
          const path = serverDatabasePath(context.app.channel, context.options.dbPath)
          const result = await countsCache.ranking(path, skills.data.map(skill => ({ id: skill.id, name: skill.name, description: skill.description ?? "" })))
          call.signal.throwIfAborted()
          return result
        } catch {
          call.signal.throwIfAborted()
          return { status: "unavailable", items: [], since: now - WINDOW_MS, until: now,
            coverage: COVERAGE, error: "Skill registry or history query unavailable" }
        }
      },
    })
    return () => registration.dispose()
  },
})
