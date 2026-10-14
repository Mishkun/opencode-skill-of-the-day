export interface CardAnchor { x: number; y: number; width: number }

/** Reserve the native bottom status row and one extra row; never partly show a card. */
export function cardFits(anchor: CardAnchor, viewport: { width: number; height: number }, height: number) {
  return [anchor.x, anchor.y, anchor.width, viewport.width, viewport.height, height].every(Number.isFinite) &&
    viewport.height >= 20 && anchor.width >= 40 && height > 0 && anchor.x >= 0 && anchor.y >= 0 &&
    anchor.x + anchor.width <= viewport.width && anchor.y + 2 + height <= viewport.height - 2
}
