import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { COVERAGE, rankSkills, WINDOW_MS, type AvailableSkill, type RankingResult } from "./ranking.ts"

/** Same filename/channel resolution as OpenCode 2.0.28's CLI database-path.ts. Runs on the SERVER only. */
export function serverDatabasePath(channel: string, override: unknown, env = process.env) {
  if (override !== undefined) {
    if (typeof override !== "string" || !isAbsolute(override)) throw new Error("invalid_path")
    return override
  }
  const data = join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode")
  const shared = ["latest", "dev", "beta", "next", "prod"].includes(channel) ||
    env.OPENCODE_DISABLE_CHANNEL_DB === "1" || env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  const filename = env.OPENCODE_DB ?? (shared ? "opencode.db" : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  if (filename === ":memory:") throw new Error("memory_database")
  return resolve(data, filename)
}

// Only projected IDs, timestamps and aggregate counts leave SQLite. No transcript/tool bodies are returned.
// V2 `executed` is the provider-executed flag; host tool success commonly has executed=false.
// Successful loading is represented by state.status='completed', not by that flag.
const COUNTS = `
WITH uses AS (
  SELECT m.id AS request_id, json_extract(s.value,'$.id') AS skill_id,
         m.time_created AS used_at
  FROM session_message m, json_each(m.data,'$.skills') s
  WHERE m.type='user' AND m.time_created >= $since AND m.time_created < $until
    AND json_type(m.data,'$.skills')='array' AND json_type(s.value,'$.id')='text'
  UNION ALL
  SELECT COALESCE((SELECT u.id FROM session_message u
                  WHERE u.session_id=m.session_id AND u.type='user' AND u.seq < m.seq
                  ORDER BY u.seq DESC LIMIT 1), m.id) AS request_id,
         COALESCE(json_extract(t.value,'$.state.input.id'),json_extract(t.value,'$.state.input.name')) AS skill_id,
         COALESCE(json_extract(t.value,'$.time.completed'),m.time_created) AS used_at
  FROM session_message m, json_each(m.data,'$.content') t
  WHERE m.type='assistant' AND m.time_updated >= $since
    AND json_extract(t.value,'$.type')='tool' AND json_extract(t.value,'$.name')='skill'
    AND json_extract(t.value,'$.state.status')='completed'
)
SELECT skill_id, count(*) AS count FROM (
  SELECT DISTINCT request_id, skill_id FROM uses
  WHERE used_at >= $since AND used_at < $until AND typeof(skill_id)='text'
) GROUP BY skill_id`

class SchemaError extends Error {}
class MissingDatabase extends Error {}

function checkSchema(db: Database) {
  const found = new Set(db.query("PRAGMA table_info(session_message)").all().map(row => (row as { name: string }).name))
  if (["id", "session_id", "type", "seq", "time_created", "time_updated", "data"].some(column => !found.has(column))) {
    throw new SchemaError()
  }
}

export function readRanking(path: string, available: readonly AvailableSkill[], now = Date.now()): RankingResult {
  const since = now - WINDOW_MS
  let db: Database | undefined
  try {
    if (!isAbsolute(path) || path === ":memory:") throw new SchemaError()
    if (!existsSync(path)) throw new MissingDatabase()
    db = new Database(path, { readonly: true, strict: true })
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=1000")
    db.exec("BEGIN")
    checkSchema(db)
    // Reject unknown attachment formats rather than silently counting them as zero.
    const unknown = db.query(`SELECT 1 FROM session_message
      WHERE type='user' AND time_created >= ? AND time_created < ?
      AND json_type(data,'$.skills') NOT IN ('array','null') LIMIT 1`).get(since, now)
    if (unknown) throw new SchemaError()
    const unknownElement = db.query(`SELECT 1 FROM session_message m, json_each(m.data,'$.skills') s
      WHERE m.type='user' AND m.time_created >= ? AND m.time_created < ?
      AND json_type(m.data,'$.skills')='array'
      AND CASE WHEN s.type='object' THEN
        json_type(s.value,'$.id') IS NOT 'text' OR length(json_extract(s.value,'$.id'))=0
        ELSE 1 END LIMIT 1`).get(since, now)
    if (unknownElement) throw new SchemaError()
    const rows = db.query(COUNTS).all({ since, until: now }) as { skill_id: string; count: number }[]
    db.exec("ROLLBACK")
    return { status: "ready", items: rankSkills(available, new Map(rows.map(row => [row.skill_id, row.count]))),
      since, until: now, coverage: COVERAGE, error: null }
  } catch (error) {
    // Never expose an SQLite error: it could embed paths or private payload fragments.
    return { status: "unavailable", items: [], since, until: now, coverage: COVERAGE,
      error: error instanceof MissingDatabase ? "History database missing" :
        error instanceof SchemaError ? "History schema unsupported" : "History query unavailable" }
  } finally {
    db?.close()
  }
}
