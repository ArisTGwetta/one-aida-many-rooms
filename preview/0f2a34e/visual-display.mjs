export function renderVisual(surface, item) {
  if (item?.type === "image" && item.src) {
    const image = surface.ownerDocument.createElement("img");
    image.src = item.src;
    image.alt = item.alt ?? "";
    image.addEventListener("error", () => { if (surface.firstElementChild === image) renderVisual(surface); }, { once: true });
    surface.replaceChildren(image);
    return;
  }
  const placeholder = surface.ownerDocument.createElement("span");
  placeholder.className = "visual-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  surface.replaceChildren(placeholder);
}
