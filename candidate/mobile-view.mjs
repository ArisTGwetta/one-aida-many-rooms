import { portraitFor } from "./emotion-portrait.mjs";
import { renderVisual } from "./visual-display.mjs";

const byId = id => document.getElementById(id);

const room = byId("mobile-room");
const settings = byId("mobile-settings");
const main = document.querySelector("main");
const transcript = byId("transcript");
const message = byId("message");
const menu = byId("mobile-menu");
const destinations = [
  [byId("mobile-settings-content"), [main]],
  [byId("mobile-history"), [transcript]],
  [byId("mobile-label"), [document.querySelector('label[for="message"]')]],
  [byId("mobile-entry"), [message, byId("send")]],
  [byId("mobile-compose-options"), [
    document.querySelector('label[for="retention"]'), byId("retention"), byId("support-label"),
    byId("chat-status"), byId("chatt-open")]]
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
  if (focus) {
    const target = open ? byId("close-mobile-settings") :
      entrance.hidden ? menu : byId("welcome-settings");
    target.focus();
  }
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
    showEntrance();
    transcript.scrollTop = transcript.scrollHeight;
    placedScrollTop = transcript.scrollTop;
    following = true;
    if (settings.hidden) (entrance.hidden ? byId("close-mobile") : welcomeTitle).focus();
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
  if (byId("provider-settings").contains(event.target)) byId("provider-settings").open = true;
  if (!room.hidden && main.contains(event.target)) openSettings(true, false);
}, true);

byId("open-mobile").addEventListener("click", () => switchView(true));
byId("close-mobile").addEventListener("click", () => switchView(false));
menu.addEventListener("click", () => openSettings(settings.hidden));
byId("close-mobile-settings").addEventListener("click", () => openSettings(false));
function leaveTheater() {
  const panel = byId("theater-room");
  if (panel.hidden) return;
  panel.dispatchEvent(new CustomEvent("theater-leave"));
  panel.hidden = true;
  byId("mobile-compose").hidden = false;
  byId("theater-open").setAttribute("aria-expanded", "false");
}
byId("theater-room").addEventListener("theater-enter", () => {
  openSettings(false, false);
  showPalace(false);
  byId("theater-room").hidden = false;
  byId("mobile-compose").hidden = true;
  room.classList.add("workspace-room");
  byId("theater-open").setAttribute("aria-expanded", "true");
  byId("theater-title").focus();
});
byId("theater-room").addEventListener("theater-exit", () => {
  showPalace(false);
  message.focus();
});
function showPalace(open) {
  leaveTheater();
  byId("glasses").hidden = true;
  byId("mobile-glasses").setAttribute("aria-expanded", "false");
  byId("mind-palace").hidden = !open;
  room.classList.toggle("workspace-room", open);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    (open ? byId("mind-palace") : byId("mobile-workspace")).animate([{ opacity: .55 }, { opacity: 1 }], { duration: 160 });
  }
  byId("mobile-palace").setAttribute("aria-expanded", String(open));
}

byId("mobile-palace").addEventListener("click", () => {
  openSettings(false, false);
  showPalace(byId("mind-palace").hidden);
  if (!byId("mind-palace").hidden) byId("mind-palace-title").focus();
});
byId("mobile-glasses").addEventListener("click", () => {
  openSettings(false, false);
  const panel = byId("glasses");
  const open = panel.hidden;
  const previous = byId("mind-palace").hidden ? "chat" : "library";
  showPalace(false);
  panel.hidden = !open;
  room.classList.toggle("workspace-room", open);
  byId("mobile-glasses").setAttribute("aria-expanded", String(open));
  if (open) {
    panel.dispatchEvent(new CustomEvent("glasses-open", { detail: previous }));
    byId("glasses-title").focus();
  }
});
byId("mobile-chat").addEventListener("click", () => {
  openSettings(false, false);
  showPalace(false);
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
const surface = byId("aida-visual");
renderVisual(surface, portraitFor());
transcript.addEventListener("aida-affect", event => {
  renderVisual(surface, portraitFor(event.detail));
});

transcript.addEventListener("scroll", () => {
  if (transcript.scrollTop === placedScrollTop) return;
  placedScrollTop = undefined;
  following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 36;
});
new MutationObserver(records => {
  if (!transcript.childElementCount) {
    following = true;
    placedScrollTop = undefined;
    renderVisual(surface, portraitFor());
    return;
  }
  if (room.hidden) return;
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

const entrance = byId("welcome-entrance");
const entranceStatus = byId("welcome-status");
const welcomeTitle = byId("welcome-title");
let arrival;

function setEntranceVisible(visible) {
  entrance.hidden = !visible;
  for (const element of room.children) {
    if (element !== entrance) element.inert = visible;
  }
}

function showEntrance() {
  const ready = entrance.dataset.authorization === "ready";
  if (!ready) {
    clearTimeout(arrival);
    arrival = undefined;
    entrance.classList.remove("arriving");
    welcomeTitle.textContent = "Welcome to Aida";
    setEntranceVisible(!room.hidden);
    return;
  }
  if (entrance.hidden || arrival !== undefined || room.hidden) return;
  showPalace(false);
  entrance.classList.add("arriving");
  welcomeTitle.textContent = "Welcome. I'm Aida.";
  arrival = setTimeout(() => {
    setEntranceVisible(false);
    arrival = undefined;
    entrance.classList.remove("arriving");
    if (!room.hidden) byId("mobile-chat").focus();
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 850);
}

const pin = byId("welcome-code");
for (const value of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Delete"]) {
  const key = document.createElement("button");
  key.type = "button";
  key.textContent = value;
  key.addEventListener("click", () => {
    if (value === "Clear") pin.value = "";
    else if (value === "Delete") pin.value = pin.value.slice(0, -1);
    else if (pin.value.length < pin.maxLength) pin.value += value;
  });
  byId("welcome-keys").append(key);
}
byId("welcome-settings").addEventListener("click", () => openSettings(true));
byId("welcome-drive").addEventListener("click", () => byId("connect").click());
entranceStatus.textContent = byId("status").textContent;
new MutationObserver(showEntrance).observe(entrance, { attributes: true, attributeFilter: ["data-authorization"] });
new MutationObserver(() => {
  if (entrance.dataset.authorization !== "ready") entranceStatus.textContent = byId("status").textContent;
}).observe(byId("status"), { childList: true, subtree: true });

switchView(true);
