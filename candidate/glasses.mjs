import { prepareSource } from "./visual-preparation.mjs";
export { maxImageBytes } from "./visual-preparation.mjs";

export function createGlassesState(prepare = prepareSource) {
  let generation = 0;
  let documentSource;
  const state = { image: null, phase: "empty", error: null, association: null, pageNumber: null, pageCount: null };
  const clear = () => {
    generation++;
    if (documentSource) void documentSource.dispose().catch(() => {});
    documentSource = undefined;
    Object.assign(state, { image: null, phase: "empty", error: null, pageNumber: null, pageCount: null });
  };
  async function navigate(pageNumber) {
    if (!documentSource || pageNumber < 1 || pageNumber > state.pageCount || state.phase === "loading") return;
    const request = ++generation;
    Object.assign(state, { image: null, phase: "loading", error: null, pageNumber });
    try {
      const image = await documentSource.render(pageNumber);
      if (request === generation) Object.assign(state, { image, phase: "ready" });
    } catch {
      if (request === generation) Object.assign(state, { phase: "failed", error: "Could not render this PDF page." });
    }
  }

  return {
    state, clear, navigate,
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
        const prepared = await prepare(file);
        if (request !== generation) {
          await prepared.dispose?.();
          return;
        }
        if (prepared.render) {
          documentSource = prepared;
          Object.assign(state, { pageCount: prepared.pageCount, phase: "empty" });
          await navigate(1);
        } else Object.assign(state, { image: prepared, phase: "ready" });
      } catch (error) {
        if (request === generation) Object.assign(state, { phase: "failed", error: error.message });
      }
    },
    snapshot() {
      return {
        evidence: { kind: "glasses_image", ...state.association, status: state.phase,
          source: state.image?.metadata ?? null, prepared: state.image?.prepared ?? null,
          adapted: state.image?.adapted ?? false, page: state.image?.page ?? null },
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
  let busy = false;
  const previous = id("glasses-previous");
  const next = id("glasses-next");
  function updateNavigation() {
    previous.disabled = busy || glasses.state.phase === "loading" || !(glasses.state.pageNumber > 1);
    next.disabled = busy || glasses.state.phase === "loading" || !(glasses.state.pageNumber < glasses.state.pageCount);
  }
  function render() {
    updateNavigation();
    id("glasses-page").textContent = glasses.state.pageCount ?
      "Page " + glasses.state.pageNumber + " of " + glasses.state.pageCount : "";
    const { image, phase, error, association } = glasses.state;
    if (image) preview.src = image.dataUrl;
    else preview.removeAttribute("src");
    preview.hidden = !image;
    id("glasses-metadata").textContent = image ? [image.metadata.name, image.metadata.type, image.metadata.bytes + " bytes",
      image.metadata.width ? "Original " + image.metadata.width + " × " + image.metadata.height : "",
      image.adapted ? "Prepared " + image.prepared.width + " × " + image.prepared.height : "",
      image.metadata.sha256 ? "SHA-256 " + image.metadata.sha256 : ""].filter(Boolean).join(" · ") : "";
    const entry = [...project.options].find(option => option.value === association?.projectId);
    id("glasses-association").textContent = "Project: " + (entry?.textContent ?? association?.projectId ?? "Everyday Chat");
    status.textContent = error ?? { empty: "No image selected.", loading: "Preparing image…", ready: image?.page ? "Only the current PDF page is sent." : image?.adapted ?
      "Adapted image ready. Fine detail may be reduced." : "Image ready for Send." }[phase];
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
  function step(offset) {
    if (busy) return;
    const pending = glasses.navigate(glasses.state.pageNumber + offset);
    render();
    void pending.then(render);
  }
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  id("glasses-clear").addEventListener("click", () => { glasses.clear(); file.value = ""; render(); });
  id("glasses-save").addEventListener("click", () => {
    status.textContent = "Durable artifact saving is unavailable. Keep the original on your device.";
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
    refresh(running) {
      busy = running;
      updateNavigation();
      for (const name of ["glasses-new", "glasses-clear", "glasses-save", "glasses-project", "glasses-file"]) id(name).disabled = busy;
      id("glasses-change-project").disabled = busy || !authorized();
    },
    reset() { glasses.reset(); file.value = ""; project.hidden = true; render(); },
    snapshot() {
      return !id("mobile-room").hidden && !id("glasses").hidden ? glasses.snapshot() : undefined;
    }
  };
}
