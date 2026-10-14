import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { isEditBufferRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { appendRemovalRequest, insertSkill } from "./editor.ts"
import { clampPage, isRankingResult, movePage, type RankingResult } from "./ranking.ts"
import { SkillOfTheDay } from "./rpc.ts"
import { cleanDisplayText, createWidgetState } from "./widget.ts"
import { homeEditor } from "./editor-target.ts"

function SkillCard() {
  const context = usePlugin()
  const dimensions = useTerminalDimensions()
  const { hidden, hide, index, setIndex } = createWidgetState()
  const [ranking, setRanking] = createSignal<RankingResult>()
  const [status, setStatus] = createSignal("Loading skill usage…")
  const [loading, setLoading] = createSignal(false)
  const location = () => context.location ?? context.data.location.default()
  const items = () => ranking()?.status === "ready" ? ranking()!.items : []
  const skill = () => items()[clampPage(index(), items().length)]
  const rpc = context.client.rpc(SkillOfTheDay)
  const abort = new AbortController()
  let generation = 0
  const width = () => Math.max(1, Math.min(dimensions().width - 4, 75) - 2)
  const title = () => {
    const text = cleanDisplayText(skill()?.name ?? "")
    const limit = Math.max(1, width() - 20)
    const chars = Array.from(text)
    return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : text
  }

  async function refresh() {
    if (hidden() || abort.signal.aborted) return
    const request = ++generation
    setLoading(true)
    try {
      const target = location()
      const [, result] = await Promise.all([
        context.data.location.skill.sync(target),
        rpc.ranking({}, { location: target, signal: abort.signal }),
      ])
      if (abort.signal.aborted || request !== generation) return
      if (!isRankingResult(result)) throw new Error("Invalid ranking response")
      const configured = context.data.location.skill.list(target)
      if (!configured) throw new Error("Registry unavailable")
      const available = new Set(configured.map(skill => skill.id))
      const filtered = { ...result, items: result.items.filter(skill => available.has(skill.id)) }
      const previousID = skill()?.id
      setRanking(filtered)
      const previousIndex = filtered.items.findIndex(skill => skill.id === previousID)
      setIndex(previousIndex < 0 ? 0 : previousIndex)
      setStatus(result.status === "unavailable" ? result.error ?? "History unavailable" :
        filtered.items.length ? "" : "No available configured skills")
    } catch {
      if (abort.signal.aborted || request !== generation) return
      setRanking(undefined)
      setStatus("Skill usage unavailable · retry")
    } finally {
      if (!abort.signal.aborted && request === generation) setLoading(false)
    }
  }

  createEffect(() => {
    location()
    untrack(() => { void refresh() })
  })

  onMount(() => {
    const seconds = context.options.refreshSeconds
    const delay = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 15 && seconds <= 3600 ? seconds : 60
    const timer = setInterval(() => { if (!loading()) void refresh() }, delay * 1000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => abort.abort())

  function edit(action: "add" | "remove") {
    const editor = homeEditor(context.ui.router.current().type, context.keymap.mode.current(), context.renderer.currentFocusedEditor)
    if (!isEditBufferRenderable(editor)) {
      context.ui.toast.show({ message: "Close dialogs, focus the home textbox, then retry.", variant: "warning" })
      return
    }
    const selected = skill()
    if (!selected) return
    if (action === "add") insertSkill(editor, selected.id)
    else appendRemovalRequest(editor, selected.id)
  }

  function Button(props: { label: string; run: () => void }) {
    return <box paddingX={1} ref={(box) => { box.focusable = false }} onMouseDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      props.run()
    }}><text selectable={false} fg={context.theme.text.base}>{props.label}</text></box>
  }

  return <Show when={!hidden()}>
    <box width="100%" marginTop={dimensions().height < 20 ? 0 : 1} paddingX={1} flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={context.theme.text.base}>Skill of the Day</text>
        <Button label="X" run={hide} />
      </box>
      <Show when={skill()} fallback={<text fg={context.theme.text.muted}>{status()}</text>}>
        <box flexDirection="row" justifyContent="space-between" height={1} overflow="hidden">
          <box flexGrow={1} minWidth={0} height={1} overflow="hidden"><text fg={context.theme.text.base}>{title()}</text></box>
          <box flexShrink={0}><text fg={context.theme.text.muted}>{skill()?.count} uses · 30d</text></box>
        </box>
        <box height={dimensions().height < 20 ? 1 : 2} overflow="hidden">
          <text fg={context.theme.text.muted}>{cleanDisplayText(skill()?.description ?? "").slice(0, 400)}</text>
        </box>
        <box flexDirection="row">
          <Button label="<-" run={() => setIndex(movePage(index(), -1, items().length))} />
          <Button label="->" run={() => setIndex(movePage(index(), 1, items().length))} />
          <Button label="Add" run={() => edit("add")} />
          <Button label="Remove" run={() => edit("remove")} />
          <text fg={context.theme.text.muted}>{clampPage(index(), items().length) + 1}/{items().length}</text>
        </box>
      </Show>
      <Show when={!skill()}><Button label={loading() ? "Loading…" : "Retry"} run={() => { if (!loading()) void refresh() }} /></Show>
    </box>
  </Show>
}

export default Plugin.define({
  id: "skill-of-the-day.tui",
  setup(context) {
    return context.ui.slot({
      prepend: "home.footer",
      render: () => <Show when={context.ui.router.current().type === "home"}>
        <box width="100%" alignItems="center" flexDirection="column" flexShrink={0} paddingX={2}>
          <box width="100%" maxWidth={75} flexDirection="column" flexShrink={0}>
            <SkillCard />
          </box>
        </box>
      </Show>,
    })
  },
})
