import { BoxRenderable, type OptimizedBuffer } from "@opentui/core"

/** Public layout-only extension: no drawing, focus, or hit-grid registration. */
export class CardAnchorRenderable extends BoxRenderable {
  override render(_buffer: OptimizedBuffer, _deltaTime: number) {}
}
