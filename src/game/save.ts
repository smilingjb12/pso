import { SAVE_VERSION, type CharacterData } from './character';

// localStorage-backed save slots. All access is guarded: storage can be
// unavailable (private mode, blocked site data) and the game must still run.

const KEY = 'pso-like-save-v2';
/** Saves from before classes were removed: deleted on first load, not migrated. */
const OLD_KEYS = ['pso-like-save-v1'];
export const SLOT_COUNT = 3;

interface SaveFile {
  slots: (CharacterData | null)[];
}

function read(): SaveFile {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SaveFile;
      if (Array.isArray(parsed.slots)) {
        while (parsed.slots.length < SLOT_COUNT) parsed.slots.push(null);
        parsed.slots = parsed.slots.map((s) => (s && s.version === SAVE_VERSION ? s : null));
        return parsed;
      }
    }
  } catch {
    // fall through to empty save
  }
  return { slots: Array.from({ length: SLOT_COUNT }, () => null) };
}

function write(file: SaveFile): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function listSlots(): (CharacterData | null)[] {
  return read().slots;
}

export function saveSlot(slot: number, data: CharacterData): boolean {
  const file = read();
  file.slots[slot] = JSON.parse(JSON.stringify(data)) as CharacterData;
  return write(file);
}

export function deleteSlot(slot: number): void {
  const file = read();
  file.slots[slot] = null;
  write(file);
}
