import { createSignal } from "solid-js"
import type { RankedSkill } from "./ranking.ts"

/** Component-local state: new home mount starts visible, with no persistence or snooze. */
export function createWidgetState() {
  const [hidden, setHidden] = createSignal(false)
  const [index, setIndex] = createSignal(0)
  // Start hidden before the first effect/request, not just after refresh starts.
  const [loading, setLoading] = createSignal(true)
  const visible = () => !hidden() && !loading()
  return { hidden, hide: () => setHidden(true), index, setIndex, loading, setLoading, visible }
}

/** One random priority per ID per Home mount; refresh never reshuffles existing IDs. */
export function createUsageOrder(random: () => number = Math.random) {
  const priority = new Map<string, number>()
  return (items: readonly RankedSkill[]) => {
    // Draw before sorting: the comparator is deterministic and count always wins.
    for (const item of items) if (!priority.has(item.id)) priority.set(item.id, random())
    return [...items].sort((a, b) => a.count - b.count || priority.get(a.id)! - priority.get(b.id)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

export function cleanDisplayText(text: string) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
}
