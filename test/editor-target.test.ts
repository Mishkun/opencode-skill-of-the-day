import { expect, test } from "bun:test"
import { homeEditor } from "../src/editor-target.ts"

test("considers the currently focused editor only on home in base input mode", () => {
  const focused = { draft: "sample draft" }
  expect(homeEditor("home", "base", focused)).toBe(focused)
  expect(homeEditor("home", "dialog", focused)).toBeNull()
  expect(homeEditor("session", "base", focused)).toBeNull()
  expect(homeEditor("plugin", "base", focused)).toBeNull()
  expect(homeEditor("home", "base", null)).toBeNull()
  expect(focused.draft).toBe("sample draft")
})
