// Small flat SVG icons for the action palette, in the spirit of PSO's palette
// glyphs. All drawn in a 48x48 box.

const svg = (body: string) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const WEAPON: Record<string, (c: string) => string> = {
  saber: (c) => `<rect x="21" y="4" width="6" height="28" rx="3" fill="${c}"/><rect x="15" y="31" width="18" height="4" fill="#9aa"/><rect x="21" y="35" width="6" height="9" fill="#556"/>`,
  sword: (c) => `<path d="M24 2 L32 10 L30 32 L18 32 L16 10 Z" fill="${c}"/><rect x="12" y="31" width="24" height="5" fill="#9aa"/><rect x="21" y="36" width="6" height="9" fill="#556"/>`,
  dagger: (c) => `<path d="M24 10 L28 16 L27 32 L21 32 L20 16 Z" fill="${c}"/><rect x="16" y="31" width="16" height="4" fill="#9aa"/><rect x="21" y="35" width="6" height="8" fill="#556"/>`,
  partisan: (c) => `<path d="M24 2 L29 12 L24 17 L19 12 Z" fill="${c}"/><rect x="16" y="15" width="16" height="3" fill="${c}"/><rect x="22" y="17" width="4" height="29" rx="2" fill="#778"/>`,
  slicer: (c) => `<circle cx="24" cy="24" r="16" fill="none" stroke="${c}" stroke-width="4"/><g fill="${c}"><path d="M24 24 L30 6 L35 11 Z"/><path d="M24 24 L42 30 L37 35 Z"/><path d="M24 24 L11 38 L8 31 Z"/></g><circle cx="24" cy="24" r="5" fill="#aab"/>`,
  handgun: (c) => `<rect x="8" y="14" width="30" height="10" rx="2" fill="#aab"/><rect x="36" y="16" width="6" height="5" fill="#667"/><path d="M12 24 L20 24 L17 38 L9 38 Z" fill="#667"/><rect x="10" y="15" width="24" height="3" fill="${c}"/>`,
  rifle: (c) => `<rect x="4" y="18" width="40" height="7" rx="2" fill="#aab"/><rect x="2" y="20" width="8" height="12" fill="#667"/><rect x="18" y="12" width="12" height="5" rx="2" fill="#667"/><path d="M20 25 L26 25 L24 34 L18 34 Z" fill="#667"/><rect x="10" y="19" width="26" height="2" fill="${c}"/>`,
  mechgun: (c) => `<rect x="8" y="12" width="26" height="14" rx="3" fill="#aab"/><rect x="33" y="13" width="10" height="4" fill="#667"/><rect x="33" y="20" width="10" height="4" fill="#667"/><circle cx="20" cy="32" r="6" fill="#667"/><rect x="10" y="13" width="20" height="3" fill="${c}"/>`,
  shot: (c) => `<rect x="4" y="16" width="30" height="12" rx="2" fill="#aab"/><path d="M33 14 L44 10 L44 34 L33 30 Z" fill="#667"/><path d="M8 28 L16 28 L13 40 L5 40 Z" fill="#667"/><rect x="7" y="17" width="24" height="3" fill="${c}"/>`,
  // Like the PSO cane glyph: a hexagon on a stick.
  cane: (c) => `<polygon points="24,3 33,8 33,18 24,23 15,18 15,8" fill="none" stroke="${c}" stroke-width="3.5"/><rect x="22" y="23" width="4" height="22" rx="2" fill="#dde"/>`,
  rod: (c) => `<circle cx="24" cy="11" r="8" fill="none" stroke="#dde" stroke-width="3"/><polygon points="24,6 28,11 24,16 20,11" fill="${c}"/><rect x="22" y="19" width="4" height="27" rx="2" fill="#dde"/>`,
  wand: (c) => `<polygon points="24,2 27,9 35,10 29,15 31,23 24,19 17,23 19,15 13,10 21,9" fill="${c}"/><rect x="22" y="20" width="4" height="24" rx="2" fill="#f4f4f4"/>`,
  none: (c) => `<circle cx="24" cy="24" r="11" fill="${c}"/><rect x="15" y="17" width="18" height="5" rx="2" fill="#000" opacity=".25"/>`,
};

const TYPE_COLOR = { light: '#bfe6ff', heavy: '#fff27a' };

/** Corner marks: light (area) is a fan of three dots, heavy (single target) double chevrons. */
const FORM_MARK = {
  light: `<g fill="${TYPE_COLOR.light}"><circle cx="5" cy="40" r="2.6"/><circle cx="11" cy="35" r="2.6"/><circle cx="17" cy="40" r="2.6"/></g>`,
  heavy: `<g fill="none" stroke="${TYPE_COLOR.heavy}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 46 L10 39 L17 46"/><path d="M3 38 L10 31 L17 38"/></g>`,
};

export function weaponIcon(kind: string, type?: 'light' | 'heavy'): string {
  const draw = WEAPON[kind] ?? WEAPON.none;
  return svg(draw(TYPE_COLOR[type ?? 'light']) + (type ? FORM_MARK[type] : ''));
}

/** A technique's glyph, with the light / heavy corner mark when it's cast in a form. */
export function techIcon(tech: string, form?: 'light' | 'heavy'): string {
  const base = techGlyph(tech);
  return form ? base.replace('</svg>', `${FORM_MARK[form]}</svg>`) : base;
}

function techGlyph(tech: string): string {
  switch (tech) {
    case 'foie':
      return svg(`<path d="M24 4 C30 14 38 18 36 30 C35 40 28 45 24 45 C18 45 11 40 12 30 C13 22 19 20 20 12 C23 17 25 18 24 4 Z" fill="#ff6a20"/><path d="M24 22 C27 28 31 31 29 37 C27 42 21 42 19 37 C18 32 22 30 24 22 Z" fill="#ffd040"/>`);
    case 'zonde':
      return svg(`<polygon points="28,2 10,27 22,27 17,46 38,18 25,18" fill="#fff060" stroke="#c8a000" stroke-width="1.5"/>`);
    case 'barta':
      return svg(
        `<g stroke="#9fe0ff" stroke-width="4" stroke-linecap="round"><line x1="24" y1="4" x2="24" y2="44"/><line x1="7" y1="14" x2="41" y2="34"/><line x1="7" y1="34" x2="41" y2="14"/></g><circle cx="24" cy="24" r="5" fill="#e8f8ff"/>`,
      );
    case 'resta':
      return svg(`<circle cx="24" cy="24" r="19" fill="none" stroke="#5aff8a" stroke-width="3"/><rect x="20" y="11" width="8" height="26" rx="2" fill="#5aff8a"/><rect x="11" y="20" width="26" height="8" rx="2" fill="#5aff8a"/>`);
    case 'shifta':
    case 'deband': {
      // The red/blue "stat up" arrow from PSO's palette.
      const c = tech === 'shifta' ? '#ff4a4a' : '#4a8aff';
      return svg(
        `<polygon points="24,3 36,17 29,17 29,30 19,30 19,17 12,17" fill="${c}"/><circle cx="10" cy="30" r="4" fill="${c}"/><circle cx="38" cy="30" r="4" fill="${c}"/><path d="M14 36 Q24 46 34 36" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      );
    }
    default:
      return svg(`<circle cx="24" cy="24" r="14" fill="#c8a0ff"/>`);
  }
}

/** Injector glyph: a pen injector, green for Mate (HP), blue for Fluid (TP). */
function injectorIcon(kind: 'mate' | 'fluid'): string {
  const [a, b] = kind === 'mate' ? ['#4ad86a', '#e8fff0'] : ['#4a9aff', '#e0f0ff'];
  return svg(
    `<g transform="rotate(45 24 24)"><rect x="18" y="6" width="12" height="26" rx="3" fill="${b}"/><rect x="20" y="13" width="8" height="16" rx="1" fill="${a}"/>` +
      `<rect x="16" y="4" width="16" height="4" rx="1.5" fill="#8a9ab8"/><rect x="22" y="32" width="4" height="5" fill="#8a9ab8"/><rect x="23.2" y="37" width="1.6" height="8" fill="#dde"/></g>`,
  );
}

export function itemIcon(id: string): string {
  const inj = /^(mate|fluid)_\d$/.exec(id);
  if (inj) return injectorIcon(inj[1] as 'mate' | 'fluid');
  switch (id) {
    case 'telepipe':
      return svg(`<rect x="18" y="8" width="12" height="32" rx="3" fill="#8ab0d8"/><ellipse cx="24" cy="8" rx="9" ry="4" fill="#4ae0ff"/><rect x="20" y="16" width="8" height="18" fill="#4ae0ff" opacity=".6"/>`);
    default:
      return svg(`<rect x="12" y="12" width="24" height="24" rx="4" fill="#9ab"/>`);
  }
}

export type ContextIcon = 'talk' | 'pickup' | 'teleport' | 'switch' | 'crate' | 'none';

export function contextIcon(kind: ContextIcon): string {
  switch (kind) {
    case 'talk':
      // The speech-bubble glyph from PSO's action button.
      return svg(
        `<path d="M8 10 H40 A4 4 0 0 1 44 14 V28 A4 4 0 0 1 40 32 H22 L12 41 L14 32 H8 A4 4 0 0 1 4 28 V14 A4 4 0 0 1 8 10 Z" fill="none" stroke="#e8f4ff" stroke-width="3.5"/><circle cx="14" cy="21" r="3" fill="#e8f4ff"/><circle cx="34" cy="21" r="3" fill="#e8f4ff"/>`,
      );
    case 'crate':
      return svg(`<rect x="9" y="12" width="30" height="28" rx="2" fill="#8a7a4a"/><rect x="8" y="22" width="32" height="6" fill="#4ab8ff"/><path d="M14 6 L20 13 M34 6 L28 13 M24 3 V11" stroke="#ffd75a" stroke-width="3" stroke-linecap="round"/>`);
    case 'pickup':
      return svg(`<polygon points="24,30 12,16 19,16 19,4 29,4 29,16 36,16" fill="#ffd75a"/><rect x="8" y="34" width="32" height="8" rx="2" fill="#e8f4ff"/>`);
    case 'teleport':
      return svg(`<ellipse cx="24" cy="38" rx="17" ry="6" fill="none" stroke="#4ae0ff" stroke-width="3.5"/><path d="M12 36 V12 M24 38 V6 M36 36 V12" stroke="#4ae0ff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`);
    case 'switch':
      return svg(`<circle cx="24" cy="26" r="15" fill="none" stroke="#ffb020" stroke-width="4"/><rect x="21" y="4" width="6" height="22" rx="3" fill="#ffb020"/>`);
    case 'none':
      return svg(`<circle cx="24" cy="24" r="4" fill="#5a7aa8"/>`);
  }
}

/** Glyph for non-weapon items in menus. */
export function typeIcon(type: string, id: string): string {
  switch (type) {
    case 'consumable':
    case 'injector':
      return itemIcon(id);
    case 'armor':
      return svg(`<path d="M24 4 L40 10 V24 C40 34 32 41 24 44 C16 41 8 34 8 24 V10 Z" fill="#7aa8e8" stroke="#dfeaff" stroke-width="2.5"/><path d="M24 12 V36" stroke="#dfeaff" stroke-width="2.5"/>`);
    case 'grinder':
      return svg(`<circle cx="24" cy="24" r="16" fill="#c8c8d8"/><circle cx="24" cy="24" r="6" fill="#606878"/><g stroke="#606878" stroke-width="3">${[0, 60, 120, 180, 240, 300].map((a) => `<line x1="24" y1="24" x2="${24 + Math.cos((a * Math.PI) / 180) * 16}" y2="${24 + Math.sin((a * Math.PI) / 180) * 16}"/>`).join('')}</g>`);
    default:
      return itemIcon(id);
  }
}

/** Status glyphs for the target frame (enemy stunned / frozen / burning / poisoned). */
export function statusIcon(kind: string): string {
  switch (kind) {
    case 'stun':
      return svg(`<polygon points="29,3 11,27 22,27 17,45 37,19 26,19" fill="#ffe040" stroke="#8a6a00" stroke-width="1.5"/>`);
    case 'freeze':
      return svg(
        `<g stroke="#bfeaff" stroke-width="4" stroke-linecap="round" fill="none"><path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14"/>` +
          `<path d="M18 7 L24 13 L30 7 M18 41 L24 35 L30 41 M5 21 L13 19 L11 11 M43 27 L35 29 L37 37 M5 27 L13 29 L11 37 M43 21 L35 19 L37 11" stroke-width="3"/></g>`,
      );
    case 'burn':
      return svg(`<path d="M24 3 C30 13 38 18 36 30 C35 40 28 45 24 45 C18 45 11 40 12 30 C13 22 19 20 20 12 C23 17 25 18 24 3 Z" fill="#ff7a20"/><path d="M24 22 C27 28 31 31 29 37 C27 42 21 42 19 37 C18 32 22 30 24 22 Z" fill="#ffd040"/>`);
    case 'poison':
      return svg(`<path d="M24 4 C31 15 38 22 38 31 A14 14 0 0 1 10 31 C10 22 17 15 24 4 Z" fill="#6ad84a"/><circle cx="19" cy="31" r="4" fill="#d8ffc8" opacity=".7"/>`);
    default:
      return svg('');
  }
}
