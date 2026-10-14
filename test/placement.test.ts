import { expect, test } from "bun:test"
import { cardFits } from "../src/placement.ts"

test("full card fits directly below the normal 80x30 and 140x50 prompt footer", () => {
  expect(cardFits({ x: 3, y: 20, width: 75 }, { width: 80, height: 30 }, 5)).toBe(true)
  expect(cardFits({ x: 33, y: 30, width: 75 }, { width: 140, height: 50 }, 5)).toBe(true)
})
test("low viewport and long input hide rather than clip the card", () => {
  expect(cardFits({ x: 3, y: 13, width: 75 }, { width: 80, height: 15 }, 4)).toBe(false)
  expect(cardFits({ x: 3, y: 25, width: 75 }, { width: 80, height: 30 }, 5)).toBe(false)
  expect(cardFits({ x: 0, y: 0, width: 75 }, { width: 80, height: 15 }, 4)).toBe(false)
})
test("card reserves the status row plus one row and accepts exact safe boundary", () => {
  expect(cardFits({ x: 3, y: 21, width: 75 }, { width: 80, height: 30 }, 5)).toBe(true)
  expect(cardFits({ x: 3, y: 22, width: 75 }, { width: 80, height: 30 }, 5)).toBe(false)
})
test("narrow, off-screen and invalid public anchor measurements fail closed", () => {
  for (const anchor of [
    { x: 0, y: 10, width: 39 }, { x: -1, y: 10, width: 75 },
    { x: 6, y: 10, width: 75 }, { x: 0, y: -1, width: 75 },
    { x: 0, y: NaN, width: 75 },
  ]) expect(cardFits(anchor, { width: 80, height: 30 }, 5)).toBe(false)
})
