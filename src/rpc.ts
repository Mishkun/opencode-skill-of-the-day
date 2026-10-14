import { Rpc } from "@opencode/plugin/rpc"

export const SkillOfTheDay = Rpc.define({
  id: "skill-of-the-day",
  methods: {
    ranking: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ready", "unavailable"] },
          items: { type: "array", items: {
            type: "object", properties: {
              id: { type: "string" }, name: { type: "string" }, description: { type: "string" },
              count: { type: "integer", minimum: 0 },
            }, required: ["id", "name", "description", "count"], additionalProperties: false,
          } },
          since: { type: "integer" }, until: { type: "integer" }, coverage: { type: "string" },
          error: { type: ["string", "null"] },
        }, required: ["status", "items", "since", "until", "coverage", "error"], additionalProperties: false,
      },
    },
  },
  events: {},
})
