/** The renderer's editor is safe to consider only in home/base input mode. */
export function homeEditor<T>(route: string, mode: string, editor: T | null): T | null {
  return route === "home" && mode === "base" ? editor : null
}
