import { plays, finishVisit } from './contracts.mjs';
export function setupTheater({ registry }) {
  if (document.getElementById('theater-open').dataset.ready) return;
  document.getElementById('theater-open').dataset.ready = 'true';
  document.getElementById('theater-open').disabled = false;
  const dialog = document.getElementById('theater-doorway');
  const chooser = document.getElementById('theater-play');
  const status = document.getElementById('theater-status');
  let entry;
  let visitId;
  for (const play of plays) {
    const option = document.createElement('option');
    option.value = play.id;
    option.textContent = play.title;
    chooser.append(option);
  }
  document.getElementById('theater-open').addEventListener('click', async () => {
    try {
      entry = await registry.dispatch({ id: 'rpg', version: 1, input: {
        schema: 'theater-entry@1', operation: 'open', playId: null, resumeRef: null
      } }, {}, 'manual');
      visitId = crypto.randomUUID();
      chooser.value = '';
      status.textContent = 'Choose a demonstration play. Theater META will be Aida’s play-scoped context.';
      dialog.showModal();
    } catch (error) { status.textContent = error.message; }
  });
  chooser.addEventListener('change', async () => {
    try {
      entry = await registry.dispatch({ id: 'rpg', version: 1, input: {
        schema: 'theater-entry@1', operation: 'open', playId: chooser.value || null, resumeRef: null
      } }, {}, 'manual');
      status.textContent = entry.playId ? 'Demonstration selected. Story and saved-play support are future work.' : 'Choose a demonstration play.';
    } catch (error) { status.textContent = error.message; }
  });
  function leave() {
    if (entry?.playId) status.textContent = JSON.stringify(finishVisit(entry, visitId), null, 2);
    else status.textContent = 'Returned without selecting a play.';
    entry = undefined;
    visitId = undefined;
    dialog.close();
  }
  document.getElementById('theater-return').addEventListener('click', leave);
  dialog.addEventListener('cancel', event => { event.preventDefault(); leave(); });
}
