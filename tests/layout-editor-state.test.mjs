import { test } from "node:test";
import assert from "node:assert/strict";
import { editElement, moveBox, recordEdit, sameLayout, travelHistory } from "../src/lib/layout-editor-state.ts";

test("layout gestures clamp complete frames inside their block and snap centers", () => {
  const box = { x: 10, y: 10, width: 30, height: 20 };
  assert.deepEqual(moveBox(box, 1000, -1000, false), { x: 70, y: 0, guides: [] });
  assert.deepEqual(moveBox(box, 25.4, 30.2), { x: 35, y: 40, guides: [{ axis: "x", value: 50 }, { axis: "y", value: 50 }] });
  const third = { x: 0, y: 0, width: 100 / 3, height: 100 / 3 };
  const edge = moveBox(third, 100, 100);
  assert.ok(edge.x + third.width <= 100 && edge.y + third.height <= 100);
});

test("server key normalization is not a layout change", () => {
  assert.ok(sameLayout({ schemaVersion: 1, blocks: { hero: { elements: { title: { x: 0, text: "a" } } } } }, { blocks: { hero: { elements: { title: { text: "a", x: 0 } } } }, schemaVersion: 1 }));
});

test("viewport edits leave desktop intact and one gesture is one undo record", () => {
  const original = { schemaVersion: 1, blocks: { hero: { elements: { title: { text: "original" } } } } };
  const selected = { blockId: "hero", elementId: "title" };
  const intermediate = editElement(original, selected, "mobile", { x: 1 });
  const final = editElement(intermediate, selected, "mobile", { x: 12 });
  const history = recordEdit({ past: [], future: [] }, original, final);
  assert.equal(original.blocks.hero.overrides, undefined);
  assert.equal(final.blocks.hero.elements.title.text, "original");
  assert.equal(final.blocks.hero.overrides.mobile.elements.title.x, 12);
  assert.equal(history.past.length, 1);
  const undone = travelHistory(history, final, "undo");
  assert.deepEqual(undone.layout, original);
  assert.deepEqual(travelHistory(undone.history, undone.layout, "redo").layout, final);
  assert.equal(recordEdit(history, final, final), history);
  let capped = history;
  for (let i = 0; i < 120; i++) capped = recordEdit(capped, original, final);
  assert.equal(capped.past.length, 100);
});
