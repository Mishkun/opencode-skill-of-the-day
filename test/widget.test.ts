import { expect, test } from "bun:test"
import { cleanDisplayText, createWidgetState, createUsageOrder } from "../src/widget.ts"

test("X hides only this widget mount and never persists a snooze", () => {
  const current = createWidgetState()
  expect(current.hidden()).toBe(false)
  current.hide()
  expect(current.hidden()).toBe(true)
  expect(createWidgetState().hidden()).toBe(false)
})

test("each home mount starts at the least-used page", () => {
  const current = createWidgetState()
  current.setIndex(5)
  expect(current.index()).toBe(5)
  expect(createWidgetState().index()).toBe(0)
})

test("registry display text cannot inject control bytes or extra lines", () => {
  expect(cleanDisplayText("Sample\n\t description\u001b\u007f")).toBe("Sample description")
  expect(cleanDisplayText("café λ")).toBe("café λ")
})

test("initial loading hides the entire widget before effects run", () => {
  const state = createWidgetState()
  expect(state.loading()).toBe(true)
  expect(state.visible()).toBe(false)
  state.setLoading(false)
  expect(state.visible()).toBe(true)
  state.setLoading(true)
  expect(state.visible()).toBe(false)
  state.setLoading(false)
  state.hide()
  expect(state.visible()).toBe(false)
})

const skills = [0, 0, 0, 1, 1, 4].map((count, index) => ({
  id: `skill-${index}`, name: `Skill ${index}`, description: "Synthetic skill", count,
}))
const ids = (items: typeof skills) => items.map(item => item.id)
function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

test("usage bands remain ascending while tie order varies reproducibly per mount", () => {
  const first = createUsageOrder(seeded(1))(skills)
  const second = createUsageOrder(seeded(42))(skills)
  expect(first.map(item => item.count)).toEqual([0, 0, 0, 1, 1, 4])
  expect(second.map(item => item.count)).toEqual([0, 0, 0, 1, 1, 4])
  expect(ids(first)).not.toEqual(ids(second))
  expect(ids(createUsageOrder(seeded(1))(skills))).toEqual(ids(first))
  expect(ids(skills)).toEqual(["skill-0", "skill-1", "skill-2", "skill-3", "skill-4", "skill-5"])
})

test("polling and refresh retain tie order without consuming fresh randomness", () => {
  let calls = 0
  const random = seeded(42)
  const order = createUsageOrder(() => { calls++; return random() })
  const initial = order(skills)
  const used = calls
  expect(ids(order([...skills].reverse()))).toEqual(ids(initial))
  expect(ids(order(skills.map(item => ({ ...item, description: "Updated" }))))).toEqual(ids(initial))
  expect(calls).toBe(used)
})

test("count changes reorder bands but preserve each skill's mount-local tie priority", () => {
  const order = createUsageOrder(seeded(42))
  const initial = order(skills)
  const changed = skills.map(item => ({ ...item, count: item.id === "skill-0" ? 5 : item.count }))
  const refreshed = order(changed)
  expect(refreshed.map(item => item.count)).toEqual([0, 0, 1, 1, 4, 5])
  expect(ids(order(skills))).toEqual(ids(initial))
  expect(ids(order(skills.filter(item => item.id !== "skill-1")))).toEqual(ids(initial.filter(item => item.id !== "skill-1")))
})

test("random priority collisions use deterministic IDs, never a random sort comparator", () => {
  const order = createUsageOrder(() => 0.5)
  expect(ids(order(skills))).toEqual(ids(order([...skills].reverse())))
})
