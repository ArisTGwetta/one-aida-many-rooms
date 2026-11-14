import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { portraitFor, portraits } from "./emotion-portrait.mjs";
import { renderVisual } from "./visual-display.mjs";

test("historical expressions map current affect without changing it; all portraits are present", async () => {
  for (const [, valence, signedArousal, file] of portraits) {
    const affect = Object.freeze({ valence, arousal: (signedArousal + 1) / 2, label: "model label" });
    const item = portraitFor(affect);
    assert.equal(item.src.split("/").at(-1), file);
    const bytes = await readFile(new URL(item.src));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  assert.match(portraitFor().src, /neutral1\.png$/);
  assert.equal(portraitFor({ valence: 0, arousal: NaN }), undefined);
  assert.equal(portraitFor({ valence: 0, arousal: -1 }), undefined);
});

test("the display accepts other images and falls back on failure without replacing newer content", () => {
  const surface = {
    ownerDocument: {
      createElement(tag) {
        return { tag, setAttribute() {}, addEventListener(name, handler) { assert.equal(name, "error"); this.fail = handler; } };
      }
    },
    replaceChildren(node) { this.firstElementChild = node; }
  };
  renderVisual(surface, portraitFor());
  const old = surface.firstElementChild;
  renderVisual(surface, { type: "image", src: "./any-output.png", alt: "A map" });
  const image = surface.firstElementChild;
  assert.equal(image.src, "./any-output.png");
  assert.equal(image.alt, "A map");
  old.fail();
  assert.equal(surface.firstElementChild, image);
  image.fail();
  assert.equal(surface.firstElementChild.className, "visual-placeholder");
});
