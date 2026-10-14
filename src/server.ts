import { Plugin } from "@opencode/plugin"
import { serverDatabasePath } from "./database.ts"
import { SkillOfTheDay } from "./rpc.ts"
import { COVERAGE, WINDOW_MS } from "./ranking.ts"
import { queryRanking } from "./worker.ts"

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
          const result = await queryRanking(path, skills.data.map(skill => ({ id: skill.id, name: skill.name, description: skill.description ?? "" })), now, call.signal)
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
