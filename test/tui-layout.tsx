import { expect, mock, test } from "bun:test"
import { render } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { parseColor } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import type { JSX } from "@opentui/solid"

let host: unknown
mock.module("@opencode/plugin/tui", () => ({
  Plugin: { define: (definition: unknown) => definition }, usePlugin: () => host,
}))
const plugin = (await import("../src/tui.tsx")).default
const items = [0, 1].map(index => ({
  id: `skill-${index}`, name: `Skill ${index}`, description: "Synthetic description", count: index,
}))

async function mount(width: number, height: number, lines: number, competingHitLayer = false, catalog = items) {
  const view = await createTestRenderer({ width, height })
  const [inputHeight, setInputHeight] = createSignal(lines)
  const [dialog, setDialog] = createSignal(false)
  let slot: () => JSX.Element = () => null
  let requests = 0
  const context = {
    location: { directory: "/synthetic" }, options: {}, renderer: view.renderer,
    theme: {
      text: { base: "white", muted: "gray", action: { secondary: { base: "white", hovered: "black" } } },
      background: { base: "black", action: { secondary: { base: "gray", hovered: "white" } } },
    },
    data: { location: { skill: { sync: async () => {}, list: () => catalog } } },
    client: { rpc: () => ({ ranking: async () => {
      requests++
      return { status: "ready", items: catalog, since: 1, until: 2, coverage: "Synthetic", error: null }
    } }) },
    keymap: { mode: { current: () => dialog() ? "modal" : "base" } },
    ui: {
      router: { current: () => ({ type: "home" }) },
      slot: (contribution: { after: string; render: () => JSX.Element }) => {
        expect(contribution.after).toBe("prompt.footer")
        slot = contribution.render
        return () => {}
      },
    },
  }
  host = context
  await plugin.setup(context as unknown as Parameters<typeof plugin.setup>[0])
  // Only the official Home spacers / Prompt wrapper and horizontal footer are
  // reproduced. All content is synthetic; no host route or private IDs used.
  await render(() => <>
    <box flexGrow={1} alignItems="center" paddingX={2}>
      <box flexGrow={1} minHeight={0} />
      <box height={3} minHeight={0} flexShrink={1} />
      <text height={3}>OpenCode logo</text>
      <box height={1} flexShrink={0} />
      <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0} position="relative">
        <box width="100%">
          <box height={1} />
          <textarea height={inputHeight()} ref={editor => editor.focus()} />
          <box height={1} /><box height={1} />
          <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
            <text flexGrow={1}>Native location</text><text>Native file</text>
            {slot()}
          </box>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} />
    </box>
    <text height={1} flexShrink={0}>Native home status</text>
    {competingHitLayer && <box position="absolute" left={0} top={height - 10} width="100%" height={9} zIndex={500} />}
    <Show when={dialog()}><box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={3000} onMouseDown={() => {}} /></Show>
  </>, view.renderer)
  await view.waitForVisualIdle()
  async function click(label: string) {
    const rows = view.captureCharFrame().split("\n")
    const y = rows.findIndex(row => row.includes(label))
    expect(y).toBeGreaterThanOrEqual(0)
    const x = rows[y]!.indexOf(label)
    await view.mockMouse.click(x, y)
    await view.waitForVisualIdle()
    return { x, y }
  }
  return { ...view, setInputHeight, setDialog, click, requests: () => requests }
}

type View = Awaited<ReturnType<typeof mount>>
function labelPosition(view: View, label: string) {
  const rows = view.captureCharFrame().split("\n")
  const y = rows.findIndex(row => row.includes(label))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: rows[y]!.indexOf(label), y }
}
function cellColors(view: View, x: number, y: number) {
  let column = 0
  for (const span of view.captureSpans().lines[y]!.spans) {
    if (x >= column && x < column + span.width) return { fg: span.fg.toInts(), bg: span.bg.toInts() }
    column += span.width
  }
  throw new Error("Expected a captured cell")
}
async function movePointer(view: View, x: number, y: number) {
  await view.mockMouse.moveTo(x, y)
  await view.waitForVisualIdle()
}

test("X shares normal and hover colors with Use and Remove", async () => {
  const view = await mount(80, 30, 1)
  try {
    const { x, y } = labelPosition(view, "X")
    const use = labelPosition(view, "Use")
    const normal = cellColors(view, use.x, use.y)
    expect(cellColors(view, x, y)).toEqual(normal)
    // Padding uses the same background as the label in both states.
    expect(cellColors(view, x - 1, y).bg).toEqual(normal.bg)
    expect(cellColors(view, x + 1, y).bg).toEqual(normal.bg)
    const remove = labelPosition(view, "Remove")
    expect(cellColors(view, x, y)).toEqual(cellColors(view, remove.x, remove.y))
    await movePointer(view, x, y)
    const hover = cellColors(view, x, y)
    expect(hover).toEqual({ fg: parseColor("black").toInts(), bg: parseColor("white").toInts() })
    expect(cellColors(view, x - 1, y).bg).toEqual(hover.bg)
    expect(cellColors(view, x + 1, y).bg).toEqual(hover.bg)
    for (const label of ["Use", "Remove"]) {
      const position = labelPosition(view, label)
      await movePointer(view, position.x, position.y)
      expect(cellColors(view, position.x, position.y)).toEqual(hover)
    }
    await movePointer(view, 0, 0)
    expect(cellColors(view, x, y)).toEqual(normal)
    expect(cellColors(view, x - 1, y).bg).toEqual(normal.bg)
    expect(cellColors(view, x + 1, y).bg).toEqual(normal.bg)
    expect(view.captureCharFrame()).toContain("Skill of the Day:")
    expect(view.requests()).toBe(1)
  } finally { view.renderer.destroy() }
}, 10000)

test("arrows, Use and Remove invert only on hover and restore without firing actions", async () => {
  const view = await mount(80, 30, 1)
  try {
    const heading = labelPosition(view, "Skill of the Day:")
    const normal = cellColors(view, heading.x, heading.y)
    expect(normal.fg).toEqual(parseColor("white").toInts())
    for (const label of ["<-", "->", "Use", "Remove"]) {
      const { x, y } = labelPosition(view, label)
      expect(cellColors(view, x, y)).toEqual(normal)
      await movePointer(view, x, y)
      expect(cellColors(view, x, y)).toEqual({ fg: parseColor("black").toInts(), bg: parseColor("white").toInts() })
      expect(cellColors(view, x - 1, y).bg).toEqual(parseColor("white").toInts())
      expect(cellColors(view, x + label.length, y).bg).toEqual(parseColor("white").toInts())
      await movePointer(view, 0, 0)
      expect(cellColors(view, x, y)).toEqual(normal)
      expect(cellColors(view, x - 1, y).bg).toEqual(normal.bg)
      expect(cellColors(view, x + label.length, y).bg).toEqual(normal.bg)
    }
    expect(view.captureCharFrame()).toContain("Skill 0")
    expect(view.renderer.currentFocusedEditor!.plainText).toBe("")
    expect(view.requests()).toBe(1)
  } finally { view.renderer.destroy() }
}, 10000)

test("Retry inverts on hover and restores without issuing another RPC", async () => {
  const view = await mount(80, 30, 1, false, [])
  try {
    const { x, y } = labelPosition(view, "Retry")
    const heading = labelPosition(view, "Skill of the Day:")
    const normal = cellColors(view, heading.x, heading.y)
    expect(cellColors(view, x, y)).toEqual(normal)
    await movePointer(view, x, y)
    expect(cellColors(view, x, y)).toEqual({ fg: parseColor("black").toInts(), bg: parseColor("white").toInts() })
    expect(cellColors(view, x - 1, y).bg).toEqual(parseColor("white").toInts())
    expect(cellColors(view, x + "Retry".length, y).bg).toEqual(parseColor("white").toInts())
    await movePointer(view, 0, 0)
    expect(cellColors(view, x, y)).toEqual(normal)
    expect(cellColors(view, x - 1, y).bg).toEqual(normal.bg)
    expect(cellColors(view, x + "Retry".length, y).bg).toEqual(normal.bg)
    expect(view.captureCharFrame()).toContain("No available configured skills")
    expect(view.requests()).toBe(1)
  } finally { view.renderer.destroy() }
}, 10000)

for (const [width, height, lines, visible] of [
  [140, 50, 1, true], [80, 30, 1, true], [80, 15, 1, false], [80, 30, 10, false],
] as const) test(`below-input fit gate at ${width}x${height}, ${lines} input lines`, async () => {
  const view = await mount(width, height, lines)
  try {
    const frame = view.captureCharFrame()
    expect(frame).toContain("Native location")
    expect(frame).toContain("Native file")
    expect(frame).toContain("Native home status")
    expect(frame.includes("Skill of the Day")).toBe(visible)
    if (visible) {
      const rows = frame.split("\n")
      expect(rows.findIndex(row => row.includes("Skill of the Day"))).toBe(rows.findIndex(row => row.includes("Native location")) + 2)
      expect(frame).toContain("Use")
      expect(frame).toContain("Remove")
      await view.click("->")
      expect(view.captureCharFrame()).toContain("Skill 1")
    } else {
      expect(frame).not.toContain("Use")
      expect(frame).not.toContain("Synthetic description")
    }
    expect(view.requests()).toBe(1)
  } finally { view.renderer.destroy() }
}, 10000)

test("mouse paging survives a later transparent hit-grid layer in another host branch", async () => {
  const view = await mount(80, 30, 1, true)
  try {
    expect(view.captureCharFrame()).toContain("Skill 0")
    await view.click("->")
    expect(view.captureCharFrame()).toContain("Skill 1")
    await view.click("<-")
    expect(view.captureCharFrame()).toContain("Skill 0")
  } finally { view.renderer.destroy() }
}, 10000)

test("header, long skill name, usage and X share one row with explicit spacing", async () => {
  const name = "sample-knowledge-base-sync"
  const view = await mount(80, 30, 1, false, [{ ...items[0]!, name }])
  try {
    const rows = view.captureCharFrame().split("\n")
    const header = rows.find(row => row.includes("Skill of the Day:"))!
    expect(header).toContain(`Skill of the Day: ${name}`)
    expect(header).toMatch(/sample-knowledge-base-sync\s+0 uses 30d\s+X/)
    expect(rows.filter(row => row.includes(name))).toHaveLength(1)
    await view.click("X")
    expect(view.captureCharFrame()).not.toContain("Skill of the Day:")
  } finally { view.renderer.destroy() }
}, 10000)

test("oversized header names are clipped before the usage and close control", async () => {
  const view = await mount(80, 30, 1, false, [{ ...items[0]!, name: "A".repeat(200), count: 1234 }])
  try {
    const header = view.captureCharFrame().split("\n").find(row => row.includes("Skill of the Day:"))!
    expect(header).toContain("…")
    expect(header).toMatch(/\s+1234 uses 30d\s+X/)
    expect(header.length).toBeLessThanOrEqual(80)
  } finally { view.renderer.destroy() }
}, 10000)

test("root portal preserves native editor hits and draft-only actions, and stays below modal hits", async () => {
  const view = await mount(80, 30, 1, true)
  try {
    const editor = view.renderer.currentFocusedEditor!
    editor.setText("Draft λ")
    editor.gotoBufferEnd()
    await view.waitForVisualIdle()
    expect(view.renderer.hitTest(editor.screenX + 1, editor.screenY)).toBe(editor.num)
    await view.click("Use")
    expect(editor.plainText).toBe("Draft λ @skill-0")
    expect(view.renderer.currentFocusedEditor).toBe(editor)
    await view.click("Remove")
    expect(editor.plainText).toContain("Please remove the @skill-0 skill")
    expect(view.renderer.currentFocusedEditor).toBe(editor)
    const arrow = await view.click("->")
    expect(view.captureCharFrame()).toContain("Skill 1")
    view.setDialog(true)
    await view.waitForVisualIdle()
    await view.mockMouse.click(arrow.x - 4, arrow.y)
    view.setDialog(false)
    await view.waitForVisualIdle()
    expect(view.captureCharFrame()).toContain("Skill 1")
    await view.click("<-")
    expect(view.captureCharFrame()).toContain("Skill 0")
    expect(view.requests()).toBe(1)
  } finally { view.renderer.destroy() }
}, 10000)

test("input growth and resize hide without hits, oscillation, extra RPC or lost selection; X stays dismissed", async () => {
  const view = await mount(80, 30, 1)
  try {
    await view.click("->")
    const previous = await view.click("<-")
    await view.click("->")
    for (let iteration = 0; iteration < 3; iteration++) {
      view.setInputHeight(10)
      await view.waitForVisualIdle()
      expect(view.captureCharFrame()).not.toContain("Skill of the Day")
      await view.mockMouse.click(previous.x, previous.y)
      view.setInputHeight(1)
      await view.waitForVisualIdle()
      expect(view.captureCharFrame()).toContain("Skill 1")
      view.resize(80, 15)
      await view.waitForVisualIdle()
      expect(view.captureCharFrame()).not.toContain("Skill of the Day")
      view.resize(80, 30)
      await view.waitForVisualIdle()
      expect(view.captureCharFrame()).toContain("Skill 1")
    }
    expect(view.requests()).toBe(1)
    await view.click("X")
    view.resize(140, 50)
    await view.waitForVisualIdle()
    expect(view.captureCharFrame()).not.toContain("Skill of the Day")
  } finally { view.renderer.destroy() }
}, 10000)
