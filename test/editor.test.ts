import { expect, test } from "bun:test"
import { appendRemovalRequest, insertSkill, type DraftEditor } from "../src/editor.ts"

function draft(text: string, cursor: number, selection: { start: number; end: number } | null = null) {
  let focusCount = 0
  const editor: DraftEditor = {
    get plainText() { return text },
    cursorOffset: cursor,
    getSelection: () => selection,
    clearSelection: () => { selection = null; return true },
    getTextRange: (start, end) => editor.plainText.slice(start, end),
    gotoBufferEnd: () => { editor.cursorOffset = editor.plainText.length; return true },
    insertText: (inserted) => {
      if (selection) throw new Error("Selection would replace existing draft")
      text = editor.plainText.slice(0, editor.cursorOffset) + inserted + editor.plainText.slice(editor.cursorOffset)
      editor.cursorOffset += inserted.length
    },
    focus: () => { focusCount++ },
  }
  return { editor, focusCount: () => focusCount }
}

test("Add preserves prefix/suffix and inserts at cursor without trailing whitespace", () => {
  const value = draft("Review this carefully", 7)
  insertSkill(value.editor, "autoresearch")
  expect(value.editor.plainText).toBe("Review @autoresearch this carefully")
  expect(value.editor.cursorOffset).toBe("Review @autoresearch".length)
  expect(value.focusCount()).toBe(1)
})

test("Add prefixes a separator without replacing a selected range", () => {
  const value = draft("Review this", 0, { start: 0, end: 6 })
  insertSkill(value.editor, "autoresearch")
  expect(value.editor.plainText).toBe("Review @autoresearch this")
  expect(value.editor.getSelection()).toBeNull()
})

test("Remove appends request rather than replacing draft or inserting at cursor", () => {
  const value = draft("Original draft", 0, { start: 0, end: 8 })
  appendRemovalRequest(value.editor, "autoresearch")
  expect(value.editor.plainText).toBe("Original draft\n\nPlease remove the @autoresearch skill from my OpenCode configuration. Use this setup’s installation workflow.")
  expect(value.focusCount()).toBe(1)
})

test("empty draft needs no leading separator", () => {
  const value = draft("", 0)
  insertSkill(value.editor, "autoresearch")
  expect(value.editor.plainText).toBe("@autoresearch")
})

test("Remove preserves Unicode draft and appends the exact approved request", () => {
  const value = draft("café λ original", 0)
  appendRemovalRequest(value.editor, "sample")
  expect(value.editor.plainText).toBe("café λ original\n\nPlease remove the @sample skill from my OpenCode configuration. Use this setup’s installation workflow.")
})

test("Remove on empty draft appends no leading blank lines", () => {
  const value = draft("", 0)
  appendRemovalRequest(value.editor, "sample")
  expect(value.editor.plainText.startsWith("Please remove")).toBe(true)
})
