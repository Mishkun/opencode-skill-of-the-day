import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readRanking, serverDatabasePath } from "../src/database.ts"
import { WINDOW_MS } from "../src/ranking.ts"
import { queryRanking } from "../src/worker.ts"

const now = 2_000_000_000_000
const skills = [
  { id: "alpha", name: "Alpha", description: "Synthetic example." },
  { id: "beta", name: "Beta", description: "Synthetic example." },
]
const created: string[] = []
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "skill-of-the-day-test-"))
  created.push(dir)
  const path = join(dir, "fixture.sqlite")
  const db = new Database(path)
  db.exec(`CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
    seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  ); CREATE INDEX session_message_session_seq_idx ON session_message(session_id,seq);
  CREATE INDEX session_message_time_created_idx ON session_message(time_created);`)
  function message(id: string, type: string, seq: number, data: unknown, time = now - 100, session = "sample-session") {
    db.query("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)").run(id, session, type, seq, time, Math.max(time, now - 1), JSON.stringify(data))
  }
  function tool(id: string, status = "completed", completed = now - 50, extra = {}) {
    return { type: "tool", id: "sample-call", name: "skill", state: { status, input: { id } }, time: { completed }, ...extra }
  }
  return { path, db, message, tool }
}

describe("SQLite ranking", () => {
  test("worker returns validated ranking without blocking the event loop", async () => {
    const f = fixture()
    f.message("user", "user", 0, { skills: [{ id: "alpha" }] })
    expect(await queryRanking(f.path, skills, now)).toEqual(readRanking(f.path, skills, now))
    f.db.close()
  })
  test("worker refuses an already cancelled RPC", async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(queryRanking(f.path, skills, now, controller.signal)).rejects.toThrow()
    f.db.close()
  })
  test("empty supported database produces real zeroes", () => {
    const f = fixture()
    const result = readRanking(f.path, skills, now)
    expect(result.status).toBe("ready")
    expect(result.items.map(s => s.count)).toEqual([0, 0])
    f.db.close()
  })
  test("native attachments and repeated successful loads deduplicate per skill/turn", () => {
    const f = fixture()
    f.message("user-1", "user", 0, { skills: [{ id: "alpha" }, { id: "alpha" }], text: "public-safe example" })
    f.message("assistant-1", "assistant", 1, { content: [f.tool("alpha"), f.tool("alpha")] })
    f.message("assistant-2", "assistant", 2, { content: [f.tool("alpha"), f.tool("beta")] })
    f.message("user-2", "user", 3, { skills: [{ id: "alpha" }] })
    const result = readRanking(f.path, skills, now)
    expect(result.items.map(s => [s.id, s.count])).toEqual([["beta", 1], ["alpha", 2]])
    f.db.close()
  })
  test("same skill in independent sessions remains separate", () => {
    const f = fixture()
    f.message("u1", "user", 0, { skills: [{ id: "alpha" }] }, now - 1, "session-one")
    f.message("u2", "user", 0, { skills: [{ id: "alpha" }] }, now - 1, "session-two")
    expect(readRanking(f.path, skills, now).items.find(s => s.id === "alpha")?.count).toBe(2)
    f.db.close()
  })
  test("host-executed completed skill calls count even with executed false", () => {
    const f = fixture()
    f.message("u", "user", 0, {})
    f.message("a", "assistant", 1, { content: [f.tool("alpha", "completed", now - 1, { executed: false })] })
    expect(readRanking(f.path, skills, now).items.find(s => s.id === "alpha")?.count).toBe(1)
    f.db.close()
  })
  test("provider-executed completed skill calls also count", () => {
    const f = fixture()
    f.message("a", "assistant", 0, { content: [f.tool("alpha", "completed", now - 1, { executed: true })] })
    expect(readRanking(f.path, skills, now).items.find(s => s.id === "alpha")?.count).toBe(1)
    f.db.close()
  })
  test("failures, pending tools and prose do not count regardless of executed flag", () => {
    const f = fixture()
    f.message("u", "user", 0, { text: "@alpha without a native attachment" })
    f.message("a", "assistant", 1, { content: [f.tool("alpha", "error"), f.tool("alpha", "running"),
      f.tool("alpha", "streaming"), f.tool("alpha", "running", now - 1, { executed: true }),
      f.tool("alpha", "error", now - 1, { executed: false }),
      { type: "text", text: "loaded alpha" }] })
    expect(readRanking(f.path, skills, now).items.map(s => s.count)).toEqual([0, 0])
    f.db.close()
  })
  test("rolling boundaries use inclusive lower and exclusive upper timestamps", () => {
    const f = fixture()
    f.message("old", "user", 0, { skills: [{ id: "alpha" }] }, now - WINDOW_MS - 1)
    f.message("start", "user", 1, { skills: [{ id: "alpha" }] }, now - WINDOW_MS)
    f.message("end", "user", 2, { skills: [{ id: "alpha" }] }, now)
    f.message("future", "user", 3, { skills: [{ id: "alpha" }] }, now + 1)
    expect(readRanking(f.path, skills, now).items.find(s => s.id === "alpha")?.count).toBe(1)
    f.db.close()
  })
  test("uses tool completion time, including a message created before the window", () => {
    const f = fixture()
    f.message("u", "user", 0, {}, now - WINDOW_MS - 2)
    f.message("a", "assistant", 1, { content: [f.tool("alpha", "completed", now - WINDOW_MS),
      f.tool("beta", "completed", now - WINDOW_MS - 1)] }, now - WINDOW_MS - 1)
    expect(readRanking(f.path, skills, now).items.map(s => [s.id, s.count])).toEqual([["beta", 0], ["alpha", 1]])
    f.db.close()
  })
  test("absent completion timestamp falls back to persisted message creation time", () => {
    const f = fixture()
    f.message("a", "assistant", 0, { content: [{ type: "tool", name: "skill", state: { status: "completed", input: { name: "alpha" } } }] })
    expect(readRanking(f.path, skills, now).items.find(s => s.id === "alpha")?.count).toBe(1)
    f.db.close()
  })
  test("empty registry stays empty even with historical uses", () => {
    const f = fixture()
    f.message("u", "user", 0, { skills: [{ id: "alpha" }] })
    expect(readRanking(f.path, [], now).items).toEqual([])
    f.db.close()
  })
  test("query leaves source rows untouched and returns no transcript/payload", () => {
    const f = fixture()
    f.message("u", "user", 0, { skills: [{ id: "alpha", text: "SYNTHETIC_SKILL_BODY" }], text: "SYNTHETIC_PROMPT_TEXT" })
    const before = f.db.query("SELECT * FROM session_message").all()
    const result = readRanking(f.path, skills, now)
    expect(f.db.query("SELECT * FROM session_message").all()).toEqual(before)
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC")
    f.db.close()
  })
  test("missing database does not create a file or fake zeroes", () => {
    const f = fixture()
    const missing = join(f.path, "missing.sqlite")
    const result = readRanking(missing, skills, now)
    expect(result.status).toBe("unavailable")
    expect(result.items).toEqual([])
    expect(result.error).toBe("History database missing")
    expect(existsSync(missing)).toBe(false)
    f.db.close()
  })
  test("unsupported schema and attachment formats return honest errors", () => {
    const f = fixture()
    f.message("u", "user", 0, { skills: { alpha: true } })
    expect(readRanking(f.path, skills, now).error).toBe("History schema unsupported")
    f.db.exec("ALTER TABLE session_message RENAME COLUMN seq TO unknown_seq")
    expect(readRanking(f.path, skills, now).error).toBe("History schema unsupported")
    f.db.close()
  })
  for (const [name, element] of [
    ["missing id", { name: "alpha" }],
    ["numeric id", { id: 42 }],
    ["null id", { id: null }],
    ["object id", { id: { name: "alpha" } }],
    ["empty id", { id: "" }],
    ["string element", "alpha"],
    ["numeric element", 42],
    ["null element", null],
    ["array element", ["alpha"]],
  ] as const) {
    test(`unsupported attachment element (${name}) is unavailable, not zero`, () => {
      const f = fixture()
      f.message("u", "user", 0, { skills: [{ id: "beta" }, element] })
      const result = readRanking(f.path, skills, now)
      expect(result.status).toBe("unavailable")
      expect(result.error).toBe("History schema unsupported")
      expect(result.items).toEqual([])
      f.db.close()
    })
  }
  test("absent and empty attachment lists are supported zero-use records", () => {
    const f = fixture()
    f.message("absent", "user", 0, { text: "Synthetic example" })
    f.message("empty", "user", 1, { skills: [] })
    const result = readRanking(f.path, skills, now)
    expect(result.status).toBe("ready")
    expect(result.items.map(s => s.count)).toEqual([0, 0])
    f.db.close()
  })
  test("malformed JSON/query failure does not leak payload or fake zeroes", () => {
    const f = fixture()
    f.db.query("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)").run("bad", "session", "user", 0, now - 1, now - 1, "NOT_JSON_SYNTHETIC")
    const result = readRanking(f.path, skills, now)
    expect(result.status).toBe("unavailable")
    expect(result.items).toEqual([])
    expect(result.error).toBe("History query unavailable")
    expect(JSON.stringify(result)).not.toContain("NOT_JSON")
    f.db.close()
  })
})

test("server database resolution honors overrides, OPENCODE_DB and channel", () => {
  const env = { XDG_DATA_HOME: "/example/data" }
  expect(serverDatabasePath("latest", undefined, env)).toBe("/example/data/opencode/opencode.db")
  expect(serverDatabasePath("preview/channel", undefined, env)).toBe("/example/data/opencode/opencode-preview-channel.db")
  expect(serverDatabasePath("latest", undefined, { ...env, OPENCODE_DB: "isolated.sqlite" })).toBe("/example/data/opencode/isolated.sqlite")
  expect(serverDatabasePath("latest", "/example/override.sqlite", env)).toBe("/example/override.sqlite")
  expect(() => serverDatabasePath("latest", "relative.sqlite", env)).toThrow()
  expect(() => serverDatabasePath("latest", undefined, { ...env, OPENCODE_DB: ":memory:" })).toThrow()
})
