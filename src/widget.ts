import { createSignal } from "solid-js"

/** Component-local state: new home mount starts visible, with no persistence or snooze. */
export function createWidgetState() {
  const [hidden, setHidden] = createSignal(false)
  const [index, setIndex] = createSignal(0)
  return { hidden, hide: () => setHidden(true), index, setIndex }
}

export function cleanDisplayText(text: string) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
}
