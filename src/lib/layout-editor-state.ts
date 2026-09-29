import type { ElementLayout, PageLayout, Viewport } from "./page-layout.ts";

export type LayoutSelection = { blockId: string; elementId: string };
export type LayoutHistory = { past: PageLayout[]; future: PageLayout[] };
export const sameLayout = (a: PageLayout, b: PageLayout) => {
  const ordered = (_key: string, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value;
  return JSON.stringify(a, ordered) === JSON.stringify(b, ordered);
};
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function editElement(layout: PageLayout, selection: LayoutSelection, viewport: Viewport, patch: Partial<ElementLayout>): PageLayout {
  const next = structuredClone(layout);
  const block = next.blocks[selection.blockId] ??= { elements: {} };
  const target = viewport === "desktop" ? block : (block.overrides ??= {})[viewport] ??= { elements: {} };
  target.elements[selection.elementId] = { ...target.elements[selection.elementId], ...patch };
  return next;
}

export function recordEdit(history: LayoutHistory, before: PageLayout, after: PageLayout): LayoutHistory {
  return sameLayout(before, after) ? history : { past: [...history.past, before].slice(-100), future: [] };
}

export function travelHistory(history: LayoutHistory, layout: PageLayout, direction: "undo" | "redo") {
  const source = direction === "undo" ? history.past : history.future;
  if (!source.length) return { history, layout };
  return direction === "undo"
    ? { layout: source[source.length - 1], history: { past: source.slice(0, -1), future: [...history.future, layout].slice(-100) } }
    : { layout: source[source.length - 1], history: { past: [...history.past, layout].slice(-100), future: source.slice(0, -1) } };
}

export function moveBox(box: { x: number; y: number; width: number; height: number }, dx: number, dy: number, snap = true) {
  const guides: { axis: "x" | "y"; value: number }[] = [];
  const coordinate = (value: number, size: number, axis: "x" | "y") => {
    let result = clamp(value, 0, Math.max(0, 100 - size));
    if (snap) for (const [position, guide] of [[0, 0], [(100 - size) / 2, 50], [100 - size, 100]]) {
      if (Math.abs(result - position) <= 1) { result = position; guides.push({ axis, value: guide }); break; }
    }
    return clamp(Math.round(result * 1000) / 1000, 0, Math.max(0, 100 - size));
  };
  return { x: coordinate(box.x + dx, box.width, "x"), y: coordinate(box.y + dy, box.height, "y"), guides };
}
