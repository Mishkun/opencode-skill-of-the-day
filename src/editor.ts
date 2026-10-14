import type { EditBufferRenderable } from "@opentui/core"

export type DraftEditor = Pick<EditBufferRenderable,
  "getSelection" | "clearSelection" | "cursorOffset" | "getTextRange" |
  "plainText" | "insertText" | "gotoBufferEnd" | "focus">

function preserveSelectedText(editor: DraftEditor) {
  const selection = editor.getSelection()
  if (!selection) return
  const end = Math.max(selection.start, selection.end)
  editor.clearSelection()
  editor.cursorOffset = end
}

export function insertSkill(editor: DraftEditor, id: string) {
  preserveSelectedText(editor)
  const left = editor.getTextRange(0, editor.cursorOffset)
  const prefix = left && !/\s$/.test(left) ? " " : ""
  const right = editor.getTextRange(editor.cursorOffset, editor.cursorOffset + 1)
  const suffix = right && !/^\s/.test(right) ? " " : ""
  editor.insertText(`${prefix}@${id}${suffix}`)
  // The caret stays at the mention's end, never beyond separator whitespace.
  if (suffix) editor.cursorOffset -= 1
  editor.focus()
}

export function appendRemovalRequest(editor: DraftEditor, id: string) {
  preserveSelectedText(editor)
  editor.gotoBufferEnd()
  const separator = editor.plainText.length ? "\n\n" : ""
  editor.insertText(`${separator}Please remove the @${id} skill from my OpenCode configuration. Use this setup’s installation workflow.`)
  editor.focus()
}
