import { skillDescriptor } from '../skill-registry.mjs';
import { validEntry } from './contracts.mjs';
export function rpgBinding() {
  return {
    descriptor: { ...skillDescriptor('rpg', 1, 'manual', 'Open the isolated RPG Theater doorway and play chooser.',
      [{ name: 'playId', description: 'Optional demonstration play selection.', required: false }]), authorization: 'user-launch' },
    validate: validEntry,
    authorize: (_input, context) => Boolean(context && Object.keys(context).length === 0),
    run: input => structuredClone(input),
    validateResult: validEntry
  };
}
