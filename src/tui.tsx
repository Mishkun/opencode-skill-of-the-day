import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { CliRenderEvents, isEditBufferRenderable, type BoxRenderable } from "@opentui/core"
import { extend, Portal, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { appendRemovalRequest, insertSkill } from "./editor.ts"
import { clampPage, isRankingResult, movePage, type RankingResult } from "./ranking.ts"
import { SkillOfTheDay } from "./rpc.ts"
import { cleanDisplayText, createUsageOrder, createWidgetState } from "./widget.ts"
import { homeEditor } from "./editor-target.ts"
import { cardFits } from "./placement.ts"
import { CardAnchorRenderable } from "./anchor.ts"

extend({ skill_of_day_anchor: CardAnchorRenderable })

function SkillCard() {
  const context = usePlugin()
  const dimensions = useTerminalDimensions()
  const [fits, setFits] = createSignal(false)
  const [placement, setPlacement] = createSignal({ x: 0, y: 0, width: 0 }, {
    equals: (a, b) => a.x === b.x && a.y === b.y && a.width === b.width,
  })
  let anchor: BoxRenderable | undefined
  const { hidden, hide, index, setIndex, loading, setLoading, visible } = createWidgetState()
  const order = createUsageOrder()
  const [ranking, setRanking] = createSignal<RankingResult>()
  const [status, setStatus] = createSignal("")
  const location = () => context.location ?? context.data.location.default()
  const items = () => ranking()?.status === "ready" ? ranking()!.items : []
  const skill = () => items()[clampPage(index(), items().length)]
  function measure() {
    const height = skill() ? 4 : 3
    if (anchor && !anchor.isDestroyed) setPlacement({
      x: anchor.screenX - context.renderer.root.screenX,
      y: anchor.screenY - context.renderer.root.screenY + 2,
      width: anchor.width,
    })
    setFits(!!anchor && !anchor.isDestroyed && cardFits({
      x: anchor.screenX, y: anchor.screenY, width: anchor.width,
    }, dimensions(), height))
  }
  // Position can change without size changing (input growth, resize, dialogs).
  // Read only our own public zero-height anchor after the host finishes layout.
  onMount(() => context.renderer.on(CliRenderEvents.FRAME, measure))
  onCleanup(() => context.renderer.off(CliRenderEvents.FRAME, measure))
  createEffect(() => {
    dimensions()
    setFits(false)
    // A hidden card has no changing renderables to schedule the measurement.
    context.renderer.requestRender()
  })
  const rpc = context.client.rpc(SkillOfTheDay)
  const abort = new AbortController()
  let generation = 0
  let selectedID: string | undefined
  let refreshing = false
  let followup: ReturnType<typeof setTimeout> | undefined
  const usage = () => `${skill()?.count ?? 0} uses 30d`
  const title = () => {
    const text = cleanDisplayText(skill()?.name ?? "")
    // Outer padding, label, X button and name padding; reserve count text first.
    const limit = Math.max(1, placement().width - 2 - 17 - 3 - 2 - usage().length)
    const chars = Array.from(text)
    return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : text
  }

  async function refresh() {
    if (hidden() || abort.signal.aborted || refreshing) return
    clearTimeout(followup)
    refreshing = true
    const request = ++generation
    selectedID = skill()?.id ?? selectedID
    // Initial/source-change loading is set separately. Updates and Retry retain the view.
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
      const filtered = { ...result, items: order(result.items.filter(skill => available.has(skill.id))) }
      const previousID = skill()?.id ?? selectedID
      setRanking(filtered)
      const previousIndex = filtered.items.findIndex(skill => skill.id === previousID)
      setIndex(previousIndex < 0 ? 0 : previousIndex)
      selectedID = skill()?.id ?? selectedID
      setStatus(result.status === "unavailable" ? result.error ?? "History unavailable" :
        filtered.items.length ? "" : "No available configured skills")
      if ("refreshInProgress" in result && result.refreshInProgress === true) {
        followup = setTimeout(() => { void refresh() }, 2_000)
      }
    } catch {
      if (abort.signal.aborted || request !== generation) return
      if (ranking()?.status !== "ready") setRanking(undefined)
      setStatus("Skill usage unavailable · retry")
    } finally {
      if (!abort.signal.aborted && request === generation) {
        refreshing = false
        setLoading(false)
      }
    }
  }

  createEffect(() => {
    location()
    untrack(() => {
      selectedID = skill()?.id ?? selectedID
      generation++
      refreshing = false
      clearTimeout(followup)
      // A different location may use another database; do not display its predecessor.
      setRanking(undefined)
      setLoading(true)
      void refresh()
    })
  })

  onMount(() => {
    const seconds = context.options.refreshSeconds
    const delay = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 15 && seconds <= 3600 ? seconds : 60
    const timer = setInterval(() => { if (!loading()) void refresh() }, delay * 1000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => { clearTimeout(followup); abort.abort() })

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

  function Button(props: { label: string; run: () => void; filled?: boolean }) {
    const [hovered, setHovered] = createSignal(false)
    // Theme-relative inverse video: X stands out normally; other controls invert on hover.
    const inverted = () => props.filled ? !hovered() : hovered()
    const background = () => inverted() ? context.theme.text.base : props.filled ? context.theme.background.action.secondary.base : undefined
    const foreground = () => inverted() ? context.theme.background.base : context.theme.text.base
    return <box paddingX={1} backgroundColor={background()} ref={(box) => { box.focusable = false }}
      onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)} onMouseDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      props.run()
    }}><text selectable={false} fg={foreground()}>{props.label}</text></box>
  }

  function FloatingCard() {
    const [container, setContainer] = createSignal<BoxRenderable>()
    createEffect(() => {
      const box = container()
      const target = placement()
      if (!box || box.isDestroyed) return
      // Portal documents its own wrapping box through ref. Configure only that
      // owned box: card-sized, above ordinary host branches, below dialogs.
      box.position = "absolute"
      box.left = target.x
      box.top = target.y
      box.width = target.width
      box.height = skill() ? 4 : 3
      box.zIndex = 1000
      box.focusable = false
    })
    return <Portal mount={context.renderer.root} ref={box => setContainer(box as BoxRenderable)}>
        <box width="100%" maxWidth={75} flexDirection="column" flexShrink={0}>
          <box width="100%" paddingX={1} flexDirection="column" flexShrink={0}>
            <box flexDirection="row" justifyContent="space-between" height={1} overflow="hidden">
              <box flexShrink={0}><text fg={context.theme.text.base}>Skill of the Day:</text></box>
              <Show when={skill()}>
                <box flexGrow={1} minWidth={0} height={1} overflow="hidden" paddingX={1}>
                  <text fg={context.theme.text.base}>{title()}</text>
                </box>
                <box flexShrink={0}><text fg={context.theme.text.muted}>{usage()}</text></box>
              </Show>
              <box flexShrink={0}><Button label="X" run={hide} filled /></box>
            </box>
            <Show when={skill()} fallback={<box height={1} overflow="hidden"><text fg={context.theme.text.muted}>{cleanDisplayText(status())}</text></box>}>
              <box height={dimensions().height < 20 ? 1 : 2} overflow="hidden">
                <text fg={context.theme.text.muted}>{cleanDisplayText(skill()?.description ?? "").slice(0, 400)}</text>
              </box>
              <box flexDirection="row">
                <Button label="<-" run={() => setIndex(movePage(index(), -1, items().length))} />
                <Button label="->" run={() => setIndex(movePage(index(), 1, items().length))} />
                <Button label="Use" run={() => edit("add")} />
                <Button label="Remove" run={() => edit("remove")} />
                <text fg={context.theme.text.muted}>{clampPage(index(), items().length) + 1}/{items().length}</text>
              </box>
            </Show>
            <Show when={!skill()}><Button label="Retry" run={() => { if (!loading()) void refresh() }} /></Show>
          </box>
        </box>
    </Portal>
  }

  return <>
    <skill_of_day_anchor position="absolute" left={0} right={0} top={0} height={0}
      ref={(box: BoxRenderable) => { anchor = box; box.focusable = false }} />
    <Show when={visible() && fits()}><FloatingCard /></Show>
  </>
}

export default Plugin.define({
  id: "skill-of-the-day.tui",
  setup(context) {
    return context.ui.slot({
      after: "prompt.footer",
      render: () => <Show when={context.ui.router.current().type === "home"}>
        <SkillCard />
      </Show>,
    })
  },
})
