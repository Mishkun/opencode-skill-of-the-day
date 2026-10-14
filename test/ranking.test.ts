import { describe, expect, test } from "bun:test"
import { clampPage, isRankingResult, movePage, rankSkills, type AvailableSkill } from "../src/ranking.ts"

export const skills: AvailableSkill[] = [
  { id: "beta", name: "Beta", description: "A public-safe sample skill." },
  { id: "alpha", name: "Alpha", description: "Another sample skill." },
  { id: "alpha-2", name: "Alpha", description: "Same-name tie fixture." },
]

describe("ranking", () => {
  test("includes zero-use skills and sorts count, stable name, then id", () => {
    expect(rankSkills(skills, new Map([["beta", 2], ["unavailable-skill", 50]])).map(s => [s.id, s.count]))
      .toEqual([["alpha", 0], ["alpha-2", 0], ["beta", 2]])
  })
  test("all-zero ranking is deterministic, independent of registry order", () => {
    expect(rankSkills([...skills].reverse(), new Map())).toEqual(rankSkills(skills, new Map()))
  })
  test("least-used wins over name and unavailable skills are not recommended", () => {
    expect(rankSkills(skills, new Map([["alpha", 4], ["alpha-2", 3]])).map(s => s.id)).toEqual(["beta", "alpha-2", "alpha"])
  })
  test("empty registry and duplicate registry IDs", () => {
    expect(rankSkills([], new Map([["alpha", 1]]))).toEqual([])
    expect(rankSkills([...skills, skills[0]], new Map())).toHaveLength(3)
  })
})

describe("paging", () => {
  test("clamps boundaries without wrapping and handles empty list", () => {
    expect(movePage(0, -1, 3)).toBe(0)
    expect(movePage(1, 1, 3)).toBe(2)
    expect(movePage(2, 1, 3)).toBe(2)
    expect(movePage(10, -1, 0)).toBe(0)
  })
  test("clamps stale index after shrinking data and invalid input", () => {
    expect(clampPage(100, 2)).toBe(1)
    expect(clampPage(-2, 2)).toBe(0)
    expect(clampPage(NaN, 2)).toBe(0)
  })
})

test("unavailable responses may not masquerade as zero-use rankings", () => {
  expect(isRankingResult({ status: "unavailable", items: [{ ...skills[0], count: 0 }], since: 0, until: 1, coverage: "", error: "missing" })).toBe(false)
  expect(isRankingResult({ status: "unavailable", items: [], since: 0, until: 1, coverage: "", error: "missing" })).toBe(true)
})
