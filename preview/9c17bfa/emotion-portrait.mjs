// Coordinates and portrait names recovered from the historical blue selector.
// Keep one original portrait per expression for this static display.
const neutral = ["neutral", 0.1, -0.1, "neutral1.png"];

export const portraits = [
  ["happy", 0.8, 0.4, "happy1.png"],
  ["excited", 0.9, 0.9, "excited1.png"],
  ["mischievous", 0.5, 0.7, "mischievous1.png"],
  neutral,
  ["focused", 0, 0.8, "focused1.png"],
  ["curious", 0.3, 0.5, "curious.png"],
  ["concerned", -0.3, 0.4, "concerned1.png"],
  ["calm", 0, -0.6, "calm1.png"],
  ["angry", -0.7, 0.8, "angry.png"],
  ["sad", -0.6, -0.4, "sad1.png"],
  ["pouting", -0.2, -0.1, "pouting1.png"],
  ["sarcastic", -0.1, 0.3, "sarcastic1.png"],
  ["surprised", 0.2, 0.9, "surprised1.png"],
  ["inviting", 0.6, 0.2, "inviting1.png"],
  ["lure", 0.4, 0.3, "lure1.png"],
  ["hello", 0.5, 0.1, "hello.png"],
  ["goodbye", -0.1, -0.2, "goodbye.png"],
  ["know_it_all", 0.1, 0.6, "Know_It_All.png"],
  ["standby", 0, -0.8, "stanby-rot1.png"]
];

export function portraitFor(affect) {
  if (!affect) return itemFor(neutral);
  const { valence, arousal } = affect;
  if (!Number.isFinite(valence) || !Number.isFinite(arousal) ||
      valence < -1 || valence > 1 || arousal < 0 || arousal > 1) return undefined;

  // The legacy selector used signed arousal. Convert the display input only.
  const signedArousal = 2 * arousal - 1;
  const distance = ([, v, a]) => (v - valence) ** 2 + (a - signedArousal) ** 2;
  const closest = portraits.reduce((best, entry) => distance(entry) < distance(best) ? entry : best);
  return itemFor(closest);
}

function itemFor([, , , file]) {
  return { type: "image", src: new URL("./portraits/" + file, import.meta.url).href, alt: "Aida’s expression" };
}
