const formats = new Map([
  ["image/png", bytes => [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)],
  ["image/jpeg", bytes => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
  ["image/webp", bytes => String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"]
]);
export const maxImageBytes = 2 * 1024 * 1024;

async function prepareImage(file) {
  const matches = formats.get(file?.type);
  if (!matches) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (!file.size || file.size > maxImageBytes) throw new Error("Choose an image no larger than 2 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matches(bytes)) throw new Error("The file does not match its image format.");
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  }
  const dataUrl = "data:" + file.type + ";base64," + btoa(chunks.join(""));
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new Error("The image could not be decoded."); }
  if (image.naturalWidth * image.naturalHeight > 16000000) throw new Error("Choose an image no larger than 16 megapixels.");
  const sha256 = globalThis.crypto?.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("") : null;
  return { dataUrl, metadata: { name: file.name.slice(0, 180), source: "selected_file", type: file.type,
    bytes: bytes.length, sha256 } };
}

export function createGlassesState(prepare = prepareImage) {
  let generation = 0;
  const state = { image: null, phase: "empty", error: null, association: null };
  const clear = () => {
    generation++;
    Object.assign(state, { image: null, phase: "empty", error: null });
  };
  return {
    state, clear,
    enter(projectId, initiatingRoom = "chat") {
      state.association ??= { initiatingRoom, initiatingProjectId: projectId, projectId, changed: false };
    },
    changeProject(projectId) {
      state.association = { ...state.association, projectId, changed: projectId !== state.association.initiatingProjectId };
    },
    reset() { clear(); state.association = null; },
    async replace(file) {
      clear();
      const request = generation;
      state.phase = "loading";
      try {
        const image = await prepare(file);
        if (request === generation) Object.assign(state, { image, phase: "ready" });
      } catch (error) {
        if (request === generation) Object.assign(state, { phase: "failed", error: error.message });
      }
    },
    snapshot() {
      return {
        evidence: { kind: "glasses_image", ...state.association, status: state.phase,
          source: state.image?.metadata ?? null },
        image: state.image?.dataUrl
      };
    }
  };
}

export function setupGlasses({ contextSource, activeProjectId, authorized, run }) {
  const id = name => document.getElementById(name);
  const glasses = createGlassesState();
  const status = id("glasses-status");
  const file = id("glasses-file");
  const project = id("glasses-project");
  const preview = id("glasses-preview");
  function render() {
    const { image, phase, error, association } = glasses.state;
    if (image) preview.src = image.dataUrl;
    else preview.removeAttribute("src");
    preview.hidden = !image;
    id("glasses-metadata").textContent = image ? [image.metadata.name, image.metadata.type, image.metadata.bytes + " bytes",
      image.metadata.sha256 ? "SHA-256 " + image.metadata.sha256 : ""].filter(Boolean).join(" · ") : "";
    const entry = [...project.options].find(option => option.value === association?.projectId);
    id("glasses-association").textContent = "Project: " + (entry?.textContent ?? association?.projectId ?? "Everyday Chat");
    status.textContent = error ?? { empty: "No image selected.", loading: "Preparing image…", ready: "Image ready for Send." }[phase];
  }
  id("glasses").addEventListener("glasses-open", event => {
    glasses.enter(activeProjectId(), event.detail);
    render();
  });
  id("glasses-new").addEventListener("click", () => {
    glasses.clear();
    file.value = "";
    render();
    file.click();
  });
  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    const pending = glasses.replace(file.files[0]);
    render();
    await pending;
    render();
  });
  id("glasses-clear").addEventListener("click", () => { glasses.clear(); file.value = ""; render(); });
  id("glasses-save").addEventListener("click", () => {
    status.textContent = "Durable image saving is unavailable. Keep the original on your device.";
  });
  id("glasses-change-project").addEventListener("click", () => {
    if (!authorized()) return;
    run("Reading project catalog…", async () => {
      const { projects } = await contextSource.load();
      project.replaceChildren(new Option("Everyday Chat", ""), ...projects.map(item => new Option(item.name, item.id)));
      project.value = glasses.state.association?.projectId ?? "";
      project.hidden = false;
      project.focus();
      return "Choose a project for subsequent inspections.";
    }, status);
  });
  project.addEventListener("change", () => { glasses.changeProject(project.value || null); render(); });
  return {
    refresh(busy) {
      for (const name of ["glasses-new", "glasses-clear", "glasses-save", "glasses-project", "glasses-file"]) id(name).disabled = busy;
      id("glasses-change-project").disabled = busy || !authorized();
    },
    reset() { glasses.reset(); file.value = ""; project.hidden = true; render(); },
    snapshot() {
      return !id("mobile-room").hidden && !id("glasses").hidden ? glasses.snapshot() : undefined;
    }
  };
}
