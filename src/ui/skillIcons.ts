import { ARTS, type ArtId } from '../game/data/arts';
import { PASSIVES, type PassiveId } from '../game/passives';

// Skills tree icons (2026-10-15: the user asked for icon-only square nodes, names in the details pane). Arts keep their
// own glyphs (icons.ts); passives and modifiers draw one of the symbols below, each in one colour on a 48x48 box: a
// passive in its role's colour (offence, defence, utility), a modifier in its Art's.

const svg = (body: string) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const line = (c: string, d: string, w = 4.5) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A star with `n` points between radius r1 and r2 around (cx, cy). */
function star(n: number, r1: number, r2: number, cx = 24, cy = 24): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** A spiral path into (24, 24). */
function spiral(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = i * 0.21;
    const r = 2 + i * 0.32;
    pts.push(`${(24 + Math.cos(a) * r).toFixed(1)} ${(24 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

export type SkillGlyph =
  | 'up' | 'down' | 'burst' | 'wide' | 'clock' | 'hourglass' | 'speed' | 'twin' | 'multi' | 'focus' | 'pierce' | 'range'
  | 'fire' | 'ice' | 'shock' | 'poison' | 'heal' | 'tp' | 'shield' | 'armor' | 'skull' | 'knock' | 'pull' | 'stagger'
  | 'boot' | 'eye' | 'cycle' | 'chain' | 'ground' | 'star' | 'blade' | 'grow' | 'tempo' | 'rage';

const GLYPHS: Record<SkillGlyph, (c: string) => string> = {
  up: (c) => line(c, 'M10 25 L24 11 L38 25 M10 38 L24 24 L38 38', 5),
  down: (c) => line(c, 'M10 10 L24 24 L38 10 M10 23 L24 37 L38 23', 5),
  burst: (c) => `<polygon points="${star(8, 21, 9)}" fill="${c}"/>`,
  wide: (c) => `<path d="M24 43 L4 15 Q24 1 44 15 Z" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>` + line(c, 'M24 43 L24 8', 3),
  clock: (c) => `<circle cx="24" cy="24" r="17" fill="none" stroke="${c}" stroke-width="4"/>` + line(c, 'M24 13 V24 L32 29'),
  hourglass: (c) => line(c, 'M13 6 H35 M13 42 H35') + `<path d="M16 7 L32 7 L24 24 L32 41 L16 41 L24 24 Z" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`,
  speed: (c) => line(c, 'M6 13 L16 24 L6 35 M19 13 L29 24 L19 35 M32 13 L42 24 L32 35', 4.5),
  twin: (c) => `<circle cx="17" cy="24" r="11" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3.5"/><circle cx="31" cy="24" r="11" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3.5"/>`,
  multi: (c) => line(c, 'M24 43 L10 17 M24 43 L24 13 M24 43 L38 17', 3.5) + `<g fill="${c}"><circle cx="9" cy="13" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="39" cy="13" r="5"/></g>`,
  focus: (c) => `<circle cx="24" cy="24" r="15" fill="none" stroke="${c}" stroke-width="3.5"/><circle cx="24" cy="24" r="4" fill="${c}"/>` + line(c, 'M24 3 V12 M24 36 V45 M3 24 H12 M36 24 H45', 3.5),
  pierce: (c) => `<rect x="14" y="9" width="5" height="30" rx="1.5" fill="${c}" opacity=".45"/><rect x="25" y="9" width="5" height="30" rx="1.5" fill="${c}" opacity=".45"/>` + line(c, 'M4 24 H42 M33 15 L42 24 L33 33'),
  range: (c) => line(c, 'M4 24 H8 M13 24 H17 M22 24 H42 M33 15 L42 24 L33 33'),
  fire: (c) => `<path d="M24 4 C30 14 38 18 36 30 C35 40 28 45 24 45 C18 45 11 40 12 30 C13 22 19 20 20 12 C23 17 25 18 24 4 Z" fill="${c}"/><path d="M24 23 C27 29 30 31 29 37 C27 42 21 42 19 37 C18 32 22 30 24 23 Z" fill="#fff" opacity=".55"/>`,
  ice: (c) => line(c, 'M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14', 4) + line(c, 'M18 7 L24 13 L30 7 M18 41 L24 35 L30 41', 3),
  shock: (c) => `<polygon points="28,2 10,27 22,27 17,46 38,18 25,18" fill="${c}"/>`,
  poison: (c) => `<g fill="${c}"><circle cx="17" cy="32" r="10"/><circle cx="31" cy="20" r="7" opacity=".8"/><circle cx="23" cy="9" r="4.5" opacity=".6"/></g>`,
  heal: (c) => `<rect x="19" y="7" width="10" height="34" rx="3" fill="${c}"/><rect x="7" y="19" width="34" height="10" rx="3" fill="${c}"/>`,
  tp: (c) => `<path d="M24 4 C31 15 38 22 38 31 A14 14 0 0 1 10 31 C10 22 17 15 24 4 Z" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="3.5"/><circle cx="19" cy="31" r="3.5" fill="${c}"/>`,
  shield: (c) => `<path d="M24 4 L40 10 V24 C40 34 32 41 24 44 C16 41 8 34 8 24 V10 Z" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`,
  armor: (c) => `<path d="M24 4 L40 10 V24 C40 34 32 41 24 44 C16 41 8 34 8 24 V10 Z" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>` + line(c, 'M26 6 L20 19 L28 25 L21 42', 3.5),
  skull: (c) => `<path d="M24 5 C35 5 41 12 41 21 C41 27 38 30 35 32 V39 H13 V32 C10 30 7 27 7 21 C7 12 13 5 24 5 Z" fill="${c}"/><g fill="#0a1430"><circle cx="17" cy="22" r="4.5"/><circle cx="31" cy="22" r="4.5"/><rect x="18" y="33" width="3" height="6"/><rect x="27" y="33" width="3" height="6"/></g>`,
  knock: (c) => `<circle cx="9" cy="24" r="5" fill="${c}"/>` + line(c, 'M19 14 Q25 24 19 34 M28 9 Q36 24 28 39 M37 5 Q47 24 37 43', 4),
  pull: (c) => line(c, spiral(), 3.5),
  stagger: (c) => `<ellipse cx="24" cy="30" rx="20" ry="8" fill="none" stroke="${c}" stroke-width="3.5"/><g fill="${c}"><polygon points="${star(4, 9, 3, 8, 30)}"/><polygon points="${star(4, 10, 3.5, 24, 14)}"/><polygon points="${star(4, 9, 3, 40, 30)}"/></g>`,
  boot: (c) => `<path d="M17 5 H29 V25 L39 28 C44 30 44 38 39 38 H14 V31 L17 29 Z" fill="${c}"/>` + line(c, 'M3 16 H11 M5 24 H12 M3 32 H10', 3),
  eye: (c) => `<path d="M3 24 Q24 4 45 24 Q24 44 3 24 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="3.5"/><circle cx="24" cy="24" r="7" fill="${c}"/>`,
  cycle: (c) => line(c, 'M38 18 A15 15 0 0 0 10 20 M10 30 A15 15 0 0 0 38 28') + `<g fill="${c}"><polygon points="41,9 42,22 30,18"/><polygon points="7,39 6,26 18,30"/></g>`,
  chain: (c) => `<g fill="none" stroke="${c}" stroke-width="4.5"><rect x="4" y="16" width="22" height="14" rx="7"/><rect x="22" y="18" width="22" height="14" rx="7"/></g>`,
  ground: (c) => line(c, 'M4 40 H44', 4) + `<g fill="${c}"><polygon points="8,38 13,18 18,38"/><polygon points="19,38 24,8 29,38"/><polygon points="30,38 35,20 40,38"/></g>`,
  star: (c) => `<polygon points="${star(4, 21, 6)}" fill="${c}"/><circle cx="37" cy="11" r="3" fill="${c}"/>`,
  blade: (c) => `<path d="M40 4 L44 8 L18 34 L12 32 L14 28 Z" fill="${c}"/>` + line(c, 'M9 27 L21 39 M13 35 L6 42', 4),
  grow: (c) => `<rect x="17" y="17" width="14" height="14" rx="2" fill="${c}"/>` + line(c, 'M6 6 L14 14 M6 6 H13 M6 6 V13 M42 6 L34 14 M42 6 H35 M42 6 V13 M6 42 L14 34 M6 42 H13 M6 42 V35 M42 42 L34 34 M42 42 H35 M42 42 V35', 3.5),
  tempo: (c) => `<path d="M14 44 L21 6 H27 L34 44 Z" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>` + line(c, 'M24 36 L33 12', 3.5) + `<circle cx="31" cy="17" r="3.5" fill="${c}"/>`,
  rage: (c) => `<path d="M24 42 C10 32 4 24 4 16 C4 9 9 5 15 5 C19 5 22 7 24 10 C26 7 29 5 33 5 C39 5 44 9 44 16 C44 24 38 32 24 42 Z" fill="${c}"/>` + line('#0a1430', 'M25 8 L20 19 L28 24 L22 36', 3),
};

export function glyphSvg(g: SkillGlyph, color: string): string {
  return svg(GLYPHS[g](color));
}

const PASSIVE_GLYPH: Record<PassiveId, SkillGlyph> = {
  tempo: 'tempo', fleet: 'boot', slipstream: 'eye', lastStand: 'heal', bulwark: 'shield', bloodlust: 'cycle',
  composure: 'shield', rush: 'speed', lightFeet: 'speed', fieldMedic: 'heal', resonance: 'up', calmMind: 'shield',
  blink: 'boot', overcast: 'rage', barrier: 'shield', purify: 'heal', focusBolt: 'focus', ward: 'shield',
  conductor: 'stagger', efficiency: 'tp', clarity: 'tp', siphonStaff: 'tp', overload: 'burst', aegis: 'shield',
  echo: 'cycle', kindle: 'fire', frostbite: 'ice', techLongshot: 'range', swiftCast: 'speed',
};

const ROLE_COLOR = { offence: '#ff8a70', defence: '#7ab8ff', utility: '#7ae0a0' } as const;

export function passiveGlyph(id: PassiveId): SkillGlyph {
  return PASSIVE_GLYPH[id];
}

export function passiveIcon(id: PassiveId): string {
  return glyphSvg(PASSIVE_GLYPH[id], ROLE_COLOR[PASSIVES[id].role]);
}

/** Modifiers by id (the same id means the same kind of change on every Art); `art:id` overrides where it doesn't. */
const MOD_GLYPH: Record<string, SkillGlyph> = {
  anti: 'heal', arcing: 'chain', big: 'grow', blast: 'burst', cataclysm: 'burst', conductor: 'chain', deep: 'armor',
  desperate: 'tp', double: 'twin', draining: 'heal', efficient: 'tp', eye: 'focus', field: 'ground',
  firewall: 'ground', five: 'multi', focused: 'focus', freezing: 'ice', frostbite: 'down', glacial: 'grow',
  greater: 'heal', ignite: 'fire', impact: 'knock', inferno: 'fire', long: 'clock', longArc: 'range',
  paralyze: 'shock', push: 'knock', quick: 'speed', regen: 'clock', scorched: 'ground', searing: 'up',
  shards: 'multi', shatter: 'burst', split: 'multi', static: 'ground', storm: 'multi', swift: 'speed', twin: 'twin',
  ward: 'shield', wide: 'wide',
  // Same id, another meaning on this Art.
  'rabarta:deep': 'ice', 'resta:swift': 'boot', 'gizonde:long': 'range', 'gibarta:long': 'range',
};

export function modGlyph(art: ArtId, mod: string): SkillGlyph {
  return MOD_GLYPH[`${art}:${mod}`] ?? MOD_GLYPH[mod] ?? 'star';
}

/** A modifier in its Art's colour (a white-ish Art's in gold, so it reads as a modifier). */
export function modIcon(art: ArtId, mod: string): string {
  const hex = ARTS[art].color === 0xffffff ? 'ffd27a' : ARTS[art].color.toString(16).padStart(6, '0');
  return glyphSvg(modGlyph(art, mod), `#${hex}`);
}
