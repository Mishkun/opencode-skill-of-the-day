import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { unlink } from "node:fs/promises"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { render } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { createSignal } from "solid-js"
import type { Context, Definition } from "@opencode/plugin/tui/plugin"
import type { JSX } from "@opentui/solid"
import type { RankingResult } from "../src/ranking.ts"
import type { BaseRenderable } from "@opentui/core"

function anchorsOnly(nodes: BaseRenderable[]): boolean {
  return nodes.every(node => node.constructor.name === "CardAnchorRenderable" && node.getChildrenCount() === 0)
}

let host: unknown
mock.module("@opencode/plugin/tui", () => ({
  Plugin: { define: (definition: unknown) => definition },
  usePlugin: () => host,
}))

const output = new URL(`../dist/tui-test-${process.pid}.js`, import.meta.url)
let plugin: Definition
beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("../src/tui.tsx", import.meta.url).pathname],
    target: "bun", format: "esm", packages: "external",
    plugins: [createSolidTransformPlugin()],
  })
  if (!built.success) throw new Error("TUI test build failed")
  await Bun.write(output, built.outputs[0]!)
  plugin = (await import(output.href)).default
})
afterAll(async () => { await unlink(output.pathname) })

const items = [0, 0, 0, 1, 1, 4].map((count, index) => ({
  id: `skill-${index}`, name: `Skill ${index}`, description: "Synthetic skill", count,
}))
const ready = (skills = items): RankingResult => ({
  status: "ready", items: skills, since: 1, until: 2, coverage: "Synthetic", error: null,
})
const theme = {
  text: { base: "white", muted: "gray", action: { secondary: { base: "white", hovered: "black" } } },
  background: { base: "black", action: { secondary: { base: "gray", hovered: "white" } } },
}

for (const height of [30]) test(`cold loading and location switches hide the card at 80x${height}`, async () => {
  const view = await createTestRenderer({ width: 80, height })
  const requests: ReturnType<typeof Promise.withResolvers<RankingResult>>[] = []
  const [location, setLocation] = createSignal({ directory: "/synthetic" })
  let renderSlot: () => JSX.Element = () => null
  host = {
    get location() { return location() },
    renderer: view.renderer,
    options: {},
    theme,
    data: { location: { skill: { sync: async () => {}, list: () => items } } },
    client: { rpc: () => ({ ranking: () => {
      const request = Promise.withResolvers<RankingResult>()
      requests.push(request)
      return request.promise
    } }) },
    ui: {
      router: { current: () => ({ type: "home" }) },
      slot: (contribution: { after: string; render: () => JSX.Element }) => {
        expect(contribution.after).toBe("prompt.footer")
        renderSlot = contribution.render
      },
    },
  }
  await plugin.setup(host as Context)
  await render(() => renderSlot(), view.renderer)
  try {
    await view.renderOnce()
    expect(requests.length).toBe(1)
    expect(view.captureCharFrame().trim()).toBe("")
    expect(anchorsOnly(view.renderer.root.getChildren())).toBe(true)
    expect(view.renderer.hitTest(0, 0)).toBe(0)

    requests[0]!.resolve(ready())
    await view.waitForFrame(frame => frame.includes("Skill of the Day"))
    expect(view.captureCharFrame()).toContain("Use")
    expect(view.captureCharFrame()).not.toContain("Add")
    expect(view.captureCharFrame()).not.toContain("Retry")

    async function click(label: string) {
      const rows = view.captureCharFrame().split("\n")
      const y = rows.findIndex(row => row.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      await view.mockMouse.click(rows[y]!.indexOf(label), y)
      await view.renderOnce()
    }
    await click("->")
    const selected = items.find(item => view.captureCharFrame().includes(item.name))!
    expect(selected).toBeDefined()

    setLocation({ directory: "/synthetic-refresh" })
    await view.renderOnce()
    expect(requests.length).toBe(2)
    expect(view.captureCharFrame().trim()).toBe("")
    expect(anchorsOnly(view.renderer.root.getChildren())).toBe(true)
    requests[1]!.resolve(ready([...items].reverse().map(item => ({
      ...item, count: item.id === selected.id ? 8 : item.count,
    }))))
    await view.waitForFrame(frame => frame.includes(selected.name))
    expect(view.captureCharFrame()).toContain("8 uses")
    expect(view.captureCharFrame()).toContain("6/6")

    setLocation({ directory: "/synthetic-error" })
    await view.renderOnce()
    requests[2]!.reject(new Error("Synthetic unavailable"))
    await view.waitForFrame(frame => frame.includes("Retry"))
    await click("Retry")
    expect(requests.length).toBe(4)
    expect(view.captureCharFrame()).toContain("Skill of the Day")
    expect(view.captureCharFrame()).toContain("Retry")
    requests[3]!.resolve(ready())
    await view.waitForFrame(frame => frame.includes(selected.name))
    await click("X")
    expect(view.captureCharFrame().trim()).toBe("")
    expect(anchorsOnly(view.renderer.root.getChildren())).toBe(true)
  } finally {
    view.renderer.destroy()
  }
}, 10000)

test("stale refresh and follow-up adoption never blank the ready card or reset selection", async () => {
  const view = await createTestRenderer({ width: 80, height: 30 })
  type Result = RankingResult & { stale?: boolean; refreshInProgress?: boolean }
  const requests: ReturnType<typeof Promise.withResolvers<Result>>[] = []
  let renderSlot: () => JSX.Element = () => null
  host = {
    location: { directory: "/synthetic" }, renderer: view.renderer, options: {},
    theme,
    data: { location: { skill: { sync: async () => {}, list: () => items } } },
    client: { rpc: () => ({ ranking: () => {
      const request = Promise.withResolvers<Result>()
      requests.push(request)
      return request.promise
    } }) },
    ui: { router: { current: () => ({ type: "home" }) },
      slot: (contribution: { render: () => JSX.Element }) => { renderSlot = contribution.render } },
  }
  await plugin.setup(host as Context)
  await render(() => renderSlot(), view.renderer)
  let monitor: ReturnType<typeof setInterval> | undefined
  const frames: string[] = []
  try {
    await view.renderOnce()
    expect(view.captureCharFrame().trim()).toBe("")
    requests[0]!.resolve({ ...ready(), stale: true, refreshInProgress: true })
    await view.waitForFrame(frame => frame.includes("Skill of the Day"))
    const rows = view.captureCharFrame().split("\n")
    const y = rows.findIndex(row => row.includes("->"))
    await view.mockMouse.click(rows[y]!.indexOf("->"), y)
    await view.renderOnce()
    const selected = items.find(item => view.captureCharFrame().includes(item.name))!
    expect(selected).toBeDefined()
    monitor = setInterval(() => frames.push(view.captureCharFrame()), 10)
    await Bun.sleep(2_100)
    expect(requests).toHaveLength(2)
    expect(view.captureCharFrame()).toContain(selected.name)
    expect(view.captureCharFrame()).not.toContain("Retry")
    requests[1]!.resolve({ ...ready([...items].reverse().map(item => ({
      ...item, count: item.id === selected.id ? 8 : item.count,
    }))), stale: false, refreshInProgress: false })
    await view.waitForFrame(frame => frame.includes("8 uses"))
    await Bun.sleep(50)
    expect(view.captureCharFrame()).toContain(selected.name)
    expect(view.captureCharFrame()).toContain("6/6")
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every(frame => frame.includes("Skill of the Day"))).toBe(true)
    await Bun.sleep(2_050)
    expect(requests).toHaveLength(2)
  } finally {
    clearInterval(monitor)
    view.renderer.destroy()
  }
}, 10000)
