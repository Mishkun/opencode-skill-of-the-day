import { expect, test } from "bun:test"
import { cleanDisplayText, createWidgetState } from "../src/widget.ts"

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
