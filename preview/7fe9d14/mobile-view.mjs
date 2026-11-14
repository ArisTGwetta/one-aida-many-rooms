const byId = id => document.getElementById(id);

export function renderVisual(surface, item) {
  if (item?.type === "image" && item.src) {
    const image = document.createElement("img");
    image.src = item.src;
    image.alt = item.alt ?? "";
    image.addEventListener("error", () => renderVisual(surface), { once: true });
    surface.replaceChildren(image);
    return;
  }
  const placeholder = document.createElement("span");
  placeholder.className = "visual-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  surface.replaceChildren(placeholder);
}

const room = byId("mobile-room");
const settings = byId("mobile-settings");
const main = document.querySelector("main");
const transcript = byId("transcript");
const message = byId("message");
const menu = byId("mobile-menu");
const destinations = [
  [byId("mobile-settings-content"), [main]],
  [byId("mobile-history"), [transcript]],
  [byId("mobile-compose"), [document.querySelector('label[for="message"]'), message,
    document.querySelector('label[for="retention"]'), byId("retention"), byId("support-label"),
    byId("send"), byId("chat-status")]]
];
const positions = new Map();
let following = true;
let placedScrollTop;

function move(node, destination) {
  const anchor = document.createComment("classic position");
  node.before(anchor);
  positions.set(node, anchor);
  destination.append(node);
}

function openSettings(open, focus = true) {
  settings.hidden = !open;
  menu.setAttribute("aria-expanded", String(open));
  if (focus) (open ? byId("close-mobile-settings") : menu).focus();
}

function switchView(mobile) {
  if (mobile === !room.hidden) return;
  if (mobile) {
    for (const [destination, elements] of destinations) {
      for (const element of elements) move(element, destination);
    }
    for (const id of ["message", "retention", "journal-support", "send"]) byId(id).setAttribute("form", "chat-form");
    room.hidden = false;
    document.body.classList.add("mobile-presentation");
    if (byId("chat").hidden || byId("send").disabled && byId("remember").disabled) openSettings(true);
    transcript.scrollTop = transcript.scrollHeight;
    placedScrollTop = transcript.scrollTop;
    following = true;
    if (settings.hidden) byId("close-mobile").focus();
  } else {
    openSettings(false, false);
    for (const [element, anchor] of positions) anchor.replaceWith(element);
    positions.clear();
    for (const id of ["message", "retention", "journal-support", "send"]) byId(id).removeAttribute("form");
    room.hidden = true;
    byId("open-mobile").focus();
  }
  document.body.classList.toggle("mobile-presentation", mobile);
  fitViewport();
}

// A required setting may need attention before the shared form can submit.
byId("chat-form").addEventListener("invalid", event => {
  if (!room.hidden && main.contains(event.target)) openSettings(true, false);
}, true);

byId("open-mobile").addEventListener("click", () => switchView(true));
byId("close-mobile").addEventListener("click", () => switchView(false));
menu.addEventListener("click", () => openSettings(settings.hidden));
byId("close-mobile-settings").addEventListener("click", () => openSettings(false));
byId("mobile-chat").addEventListener("click", () => {
  openSettings(false, false);
  message.focus();
});
byId("mobile-sleep").addEventListener("click", () => {
  openSettings(true, false);
  const panel = byId("sleep-panel");
  panel.open = true;
  panel.querySelector("summary").focus();
  panel.scrollIntoView({ block: "start" });
});
byId("mobile-theme").addEventListener("change", event => { document.body.dataset.mobileTheme = event.target.value; });
byId("mobile-text-size").addEventListener("change", event => { room.dataset.textSize = event.target.value; });
renderVisual(byId("aida-visual"));

transcript.addEventListener("scroll", () => {
  if (transcript.scrollTop === placedScrollTop) return;
  placedScrollTop = undefined;
  following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 36;
});
new MutationObserver(records => {
  if (room.hidden) return;
  if (!transcript.childElementCount) { following = true; placedScrollTop = undefined; return; }
  if (!following) return;
  const reply = records.flatMap(record => [...record.addedNodes]).reverse()
    .find(node => node.dataset?.speaker === "aida");
  if (reply) {
    transcript.scrollTop += reply.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
    placedScrollTop = transcript.scrollTop;
  }
}).observe(transcript, { childList: true });

new MutationObserver(() => {
  if (!room.hidden && !byId("project-preview").hidden) openSettings(true);
}).observe(byId("project-preview"), { attributes: true, attributeFilter: ["hidden"] });

const viewport = window.visualViewport;
function fitViewport() {
  if (viewport?.scale === 1 && !room.hidden) {
    document.body.style.setProperty("--mobile-height", viewport.height + "px");
    document.body.style.setProperty("--mobile-top", viewport.offsetTop + "px");
  }
}
viewport?.addEventListener("resize", fitViewport);
viewport?.addEventListener("scroll", fitViewport);
fitViewport();
