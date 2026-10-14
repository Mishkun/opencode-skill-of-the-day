export interface AvailableSkill {
  id: string
  name: string
  description: string
}
export interface RankedSkill extends AvailableSkill { count: number }
export type RankingResult = {
  status: "ready" | "unavailable"
  items: RankedSkill[]
  since: number
  until: number
  coverage: string
  error: string | null
}
export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const COVERAGE = "Successful explicit skill loads and native user-attached skills, once per skill/user turn. All stored V2 sessions on this server; excludes prose, failures and pending prompts. Fork copies may inflate counts."

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function rankSkills(available: readonly AvailableSkill[], counts: ReadonlyMap<string, number>) {
  return [...new Map(available.map(skill => [skill.id, skill])).values()]
    .map(skill => ({ ...skill, count: counts.get(skill.id) ?? 0 }))
    .sort((a, b) => a.count - b.count || compare(a.name, b.name) || compare(a.id, b.id))
}

export function clampPage(index: number, total: number) {
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(Math.trunc(index), Math.max(0, total - 1)))
}
export function movePage(index: number, direction: -1 | 1, total: number) {
  return clampPage(clampPage(index, total) + direction, total)
}

export function isRankingResult(value: unknown): value is RankingResult {
  if (!value || typeof value !== "object") return false
  const r = value as Record<string, unknown>
  return (r.status === "ready" || r.status === "unavailable") &&
    Number.isSafeInteger(r.since) && Number.isSafeInteger(r.until) &&
    typeof r.coverage === "string" && (r.error === null || typeof r.error === "string") &&
    Array.isArray(r.items) && r.items.every(item => item && typeof item === "object" &&
      typeof item.id === "string" && typeof item.name === "string" &&
      typeof item.description === "string" && Number.isSafeInteger(item.count) && item.count >= 0) &&
    (r.status !== "unavailable" || r.items.length === 0)
}
