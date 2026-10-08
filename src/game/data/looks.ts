import { areas, type AreaDef, type AreaId, type AreaTheme, type SkyDef } from './areas';

// Area looks: palette, sky, fog, light, glow colours and bloom. The Caves are a
// bioluminescent grotto, the Mines a neon megafactory under a night sky, the Ruins
// a temple lit from within; each
// area has three variants to compare in /arealab.html. The game uses the
// variant picked there (this browser) or the one baked into LOOK_PICKS.

export interface AreaLook {
  name: string;
  desc: string;
  theme: Partial<AreaTheme>;
}

/** Picked variant per area (index into LOOKS[area]); 0 when missing. */
export const LOOK_PICKS: Partial<Record<AreaId, number>> = {};

interface Family {
  name: string;
  desc: string;
  sky: SkyDef;
  fog: number;
  floor: number;
  floorAlt: number;
  wall: number;
  accent: number;
  accent2: number;
  accent3: number;
  lava: number;
  pool?: number;
  motes: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  /** Light intensities (defaults 1.3 ambient, 1.1 sun): the Ruins are lit lower. */
  hemi?: number;
  sunI?: number;
}

// ------------------------------------------------------------------ Mines

const NEON: Family[] = [
  {
    name: 'Synthwave',
    desc: 'Magenta and cyan neon under an indigo-to-pink sky with a ringed orange gas giant.',
    sky: {
      top: 0x0b0322, horizon: 0xd8307a, bottom: 0x140428, stars: 1,
      nebulae: [{ color: 0xff2a90, dir: [0.6, 0.12, -1], size: 170, opacity: 0.35 }, { color: 0x6a3aff, dir: [-0.8, 0.5, 0.3], size: 150, opacity: 0.3 }],
      planet: { color: 0xff9a50, color2: 0xd04a6a, ring: 0xffc890, glow: 0xff7a60, dir: [-0.45, 0.32, -1], size: 34 },
    },
    fog: 0x2a0c3e, floor: 0x282b59, floorAlt: 0x22254b, wall: 0x251b3e,
    accent: 0xff3ab8, accent2: 0x36e6ff, accent3: 0xffd040, lava: 0xff3a8a, motes: 0xff80d0,
    hemiSky: 0xa070ff, hemiGround: 0x1a0628, sun: 0xff9ad8,
  },
  {
    name: 'Cyber teal',
    desc: 'Cyan, blue and white light on deep navy steel; a pale blue ringed planet.',
    sky: {
      top: 0x020814, horizon: 0x0e5a7a, bottom: 0x01050c, stars: 1,
      nebulae: [{ color: 0x20c8ff, dir: [0.7, 0.2, -1], size: 170, opacity: 0.3 }, { color: 0x3a50ff, dir: [-0.6, 0.6, 0.4], size: 150, opacity: 0.3 }],
      planet: { color: 0x4a7aff, color2: 0x9ad8ff, ring: 0xa0f0ff, glow: 0x60a0ff, dir: [0.5, 0.3, -1], size: 28 },
    },
    fog: 0x08243a, floor: 0x1e344b, floorAlt: 0x1a2c41, wall: 0x142032,
    accent: 0x2ef0ff, accent2: 0x5a7cff, accent3: 0xe8f6ff, lava: 0x50e0ff, motes: 0x80e8ff,
    hemiSky: 0x80c8ff, hemiGround: 0x081420, sun: 0xc0e8ff,
  },
  {
    name: 'Vapor sunset',
    desc: 'Amber and pink neon against an orange horizon and a huge violet planet.',
    sky: {
      top: 0x170a3a, horizon: 0xff7a48, bottom: 0x2a0a2a, stars: 0.6,
      nebulae: [{ color: 0xff8a40, dir: [0, 0.05, -1], size: 220, opacity: 0.4 }, { color: 0xff40a0, dir: [-0.9, 0.3, -0.3], size: 140, opacity: 0.3 }],
      planet: { color: 0x9a5aff, color2: 0xff7ab0, ring: 0xffb0d0, glow: 0xc070ff, dir: [0.25, 0.25, -1], size: 52 },
    },
    fog: 0x4a1e48, floor: 0x3c315f, floorAlt: 0x352b55, wall: 0x2d2046,
    accent: 0xffa838, accent2: 0xff4aa0, accent3: 0x7ad8ff, lava: 0xffa030, motes: 0xffc070,
    hemiSky: 0xffa0c0, hemiGround: 0x2a0c20, sun: 0xffc090,
  },
];

// ------------------------------------------------------------------ Caves

const GROTTO: Family[] = [
  {
    name: 'Teal lagoon',
    desc: 'Teal and violet crystals, glowing turquoise water, a green-violet aurora overhead.',
    sky: {
      top: 0x020a16, horizon: 0x0b4a5a, bottom: 0x01060a, stars: 1,
      aurora: { color: 0x30ffc0, color2: 0x7a40ff, strength: 0.9 },
      nebulae: [{ color: 0x7a40ff, dir: [0.7, 0.4, 0.5], size: 150, opacity: 0.25 }],
    },
    fog: 0x0a2836, floor: 0x494268, floorAlt: 0x3f3a5f, wall: 0x2f2648,
    accent: 0x3af0e0, accent2: 0xa070ff, accent3: 0xff6ad0, lava: 0xff6a28, pool: 0x20d8c8, motes: 0x70ffd8,
    hemiSky: 0x80d8ff, hemiGround: 0x1a1030, sun: 0xa8d0ff,
  },
  {
    name: 'Violet crystal',
    desc: 'Violet and pink crystal light, periwinkle water, a pink aurora and a pale moon.',
    sky: {
      top: 0x0a0420, horizon: 0x4a2a8a, bottom: 0x06020e, stars: 1,
      aurora: { color: 0xff60d0, color2: 0x7a50ff, strength: 0.85 },
      planet: { color: 0xd8d0ff, color2: 0xb0a8e8, glow: 0xc0b0ff, dir: [0.6, 0.45, -1], size: 12 },
    },
    fog: 0x22163e, floor: 0x51426e, floorAlt: 0x483b65, wall: 0x342850,
    accent: 0xc070ff, accent2: 0xff6ac8, accent3: 0x6aa8ff, lava: 0xff5a50, pool: 0x6a8aff, motes: 0xe0a0ff,
    hemiSky: 0xc0a0ff, hemiGround: 0x200a30, sun: 0xe0c0ff,
  },
  {
    name: 'Emerald spores',
    desc: 'Green and gold glow, mint water, drifting spores and a green-cyan aurora.',
    sky: {
      top: 0x02100c, horizon: 0x14583a, bottom: 0x010806, stars: 0.9,
      aurora: { color: 0x50ff80, color2: 0x40d0ff, strength: 0.85 },
    },
    fog: 0x0a2a20, floor: 0x424e4e, floorAlt: 0x3b4747, wall: 0x283434,
    accent: 0x5aff90, accent2: 0x40e0ff, accent3: 0xffe060, lava: 0xffa030, pool: 0x40ffa0, motes: 0xb0ff70,
    hemiSky: 0xa0ffd0, hemiGround: 0x0a2018, sun: 0xd0ffe0,
  },
];

// ------------------------------------------------------------------ Ruins

// An ancient temple of the Dark, darker and more ominous than the Caves or the Mines (the user's ask,
// 2026-10-08): dim stone under a black sky (an eclipse, a blood moon, the void), lit by glowing glyph
// bands (accent), trim (accent2) and pylon light (accent3, always a warm or clear light against the dark).
const TEMPLE: Family[] = [
  {
    name: 'Eclipse',
    desc: 'Dark violet stone and crimson glyphs under a black sun with a burning corona.',
    sky: {
      top: 0x020104, horizon: 0x2a0818, bottom: 0x010003, stars: 0.5,
      nebulae: [{ color: 0x8a1040, dir: [-0.5, 0.2, -1], size: 220, opacity: 0.3 }, { color: 0x4a1080, dir: [0.8, 0.5, 0.3], size: 160, opacity: 0.25 }],
      planet: { color: 0x040206, color2: 0x0a0408, glow: 0xff3a5a, glowOpacity: 0.85, dir: [-0.35, 0.32, -1], size: 26 },
    },
    fog: 0x0e0510, floor: 0x3a3048, floorAlt: 0x342b42, wall: 0x241c30,
    accent: 0xff3a5a, accent2: 0x9a40ff, accent3: 0xffe0a0, lava: 0xff3a3a, motes: 0xff8aa0,
    hemiSky: 0x9a70c0, hemiGround: 0x0a0410, sun: 0xffb0a0, hemi: 0.75, sunI: 0.7,
  },
  {
    name: 'Blood moon',
    desc: 'Charcoal stone and ember glyphs under a huge red moon in a smoky crimson sky.',
    sky: {
      top: 0x050104, horizon: 0x4a0a0e, bottom: 0x020001, stars: 0.35,
      nebulae: [{ color: 0xa01818, dir: [0.2, 0.1, -1], size: 240, opacity: 0.3 }],
      planet: { color: 0xc02818, color2: 0x701010, glow: 0xff4020, glowOpacity: 0.5, dir: [0.3, 0.38, -1], size: 46, light: [-0.4, 0.3, 1] },
    },
    fog: 0x160406, floor: 0x3a3436, floorAlt: 0x332d30, wall: 0x241e22,
    accent: 0xff7a30, accent2: 0xc02840, accent3: 0xfff0c0, lava: 0xff4a20, motes: 0xffa060,
    hemiSky: 0xc08070, hemiGround: 0x100406, sun: 0xff9070, hemi: 0.7, sunI: 0.75,
  },
  {
    name: 'The void',
    desc: 'Cold blue-black stone and cyan glyphs under an empty sky, a thin violet aurora at its edge.',
    sky: {
      top: 0x000104, horizon: 0x061428, bottom: 0x000102, stars: 0.8,
      aurora: { color: 0x6a40ff, color2: 0x20c0ff, strength: 0.55 },
    },
    fog: 0x040a16, floor: 0x2e3850, floorAlt: 0x283148, wall: 0x1a2134,
    accent: 0x40e8ff, accent2: 0x8a5aff, accent3: 0xeafff8, lava: 0x50e0ff, motes: 0x90e8ff,
    hemiSky: 0x7090c0, hemiGround: 0x040810, sun: 0xb0c8ff, hemi: 0.7, sunI: 0.7,
  },
];

function look(f: Family, extra: Partial<AreaTheme>, gloss: number): AreaLook {
  return {
    name: f.name,
    desc: f.desc,
    theme: {
      floor: f.floor, floorAlt: f.floorAlt, wall: f.wall,
      sky: f.sky.horizon, skybox: f.sky, fogColor: f.fog,
      accent: f.accent, accent2: f.accent2, accent3: f.accent3, lava: f.lava, pool: f.pool, motes: f.motes,
      floorGloss: gloss,
      envIntensity: gloss > 0.3 ? 0.7 : 0.35,
      light: { hemiSky: f.hemiSky, hemiGround: f.hemiGround, hemi: f.hemi ?? 1.3, sunColor: f.sun, sun: f.sunI ?? 1.1 },
      ...extra,
    },
  };
}

/** The caves glow softly: only the brightest things (lava, crystal cores) bloom, with a tight halo. */
const CAVE_BLOOM = { strength: 0.24, radius: 0.25, threshold: 0.84 };
/** Neon gets a little more, still only on the brightest strips and lights. */
const MINE_BLOOM = { strength: 0.3, radius: 0.3, threshold: 0.82 };
/** The dark temple: glyphs, pylon light and the corona bloom against the gloom. */
const TEMPLE_BLOOM = { strength: 0.34, radius: 0.35, threshold: 0.8 };

export const LOOKS: Partial<Record<AreaId, AreaLook[]>> = {
  cave1: GROTTO.map((f) => look(f, { fogNear: 28, fogFar: 95, bloom: CAVE_BLOOM }, 0)),
  cave2: GROTTO.map((f) => look(f, { fogNear: 28, fogFar: 95, bloom: CAVE_BLOOM }, 0.15)),
  mine1: NEON.map((f) => look(f, { fogNear: 32, fogFar: 105, bloom: MINE_BLOOM }, 0.8)),
  mine2: NEON.map((f) => look(f, { fogNear: 32, fogFar: 105, bloom: MINE_BLOOM }, 0.85)),
  warden: NEON.map((f) => look(f, { fogNear: 40, fogFar: 130, bloom: MINE_BLOOM }, 0.85)),
  ruin1: TEMPLE.map((f) => look(f, { fogNear: 22, fogFar: 80, bloom: TEMPLE_BLOOM }, 0.25)),
  ruin2: TEMPLE.map((f) => look(f, { fogNear: 20, fogFar: 75, bloom: TEMPLE_BLOOM }, 0.3)),
  falz: TEMPLE.map((f) => look(f, { fogNear: 40, fogFar: 140, bloom: TEMPLE_BLOOM }, 0.3)),
};

// ------------------------------------------------------- picks (lab + baked)

export const LOOK_PICKS_KEY = 'pso.areaLooks';
let cache: Partial<Record<AreaId, number>> | null = null;

export function labLookPicks(): Partial<Record<AreaId, number>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(LOOK_PICKS_KEY) ?? '{}') ?? {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function setLabLookPicks(p: Partial<Record<AreaId, number>>): void {
  cache = p;
  try {
    localStorage.setItem(LOOK_PICKS_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: picks last for this page only.
  }
}

// The lab usually runs in another tab: pick up its changes live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOOK_PICKS_KEY) cache = null;
  });
}

export function lookPick(id: AreaId): number {
  return labLookPicks()[id] ?? LOOK_PICKS[id] ?? 0;
}

/** An area's definition with its look applied (variant `index`, or the current pick). */
export function areaDef(id: AreaId, index?: number): AreaDef {
  const def = areas[id];
  const looks = LOOKS[id];
  if (!looks) return def;
  const l = looks[index ?? lookPick(id)] ?? looks[0];
  return { ...def, theme: { ...def.theme, ...l.theme } };
}
