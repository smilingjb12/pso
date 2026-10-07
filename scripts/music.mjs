// Generate music files with the ElevenLabs Music API.
//
//   npm run music                              generate every missing file
//   npm run music -- caves-calm                (re)generate just these ids
//   npm run music -- --variants caves-calm     generate the missing labelled variants
//   npm run music -- --use caves-calm B        make variant B the one the game plays
//
// Reads ELEVENLABS_API_KEY from .env. Files land in public/music/<id>.mp3 and
// are picked up by tracks that list them in `files` (src/audio/music/tracks.ts).
// Variants land in public/music/variants/ and are listed in its index.json,
// which the Sound Lab reads so they can be auditioned side by side.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'music');
const varDir = join(outDir, 'variants');

// Shared direction for every in-game loop: background music that repeats.
const LOOP = 'Instrumental only, no vocals. One steady section from start to finish with no intro, no build-up, no ending and no fade-out, so it can loop seamlessly as video game background music.';
const ERA = 'Video game soundtrack in the style of early-2000s Japanese action RPGs (Dreamcast era, Phantasy Star Online).';

// Shared bans: the synth score's dark drones and bells grated, so keep them out.
const NO = 'No bells, chimes, glockenspiel, vibraphone, music box, dark synth drones or vocals.';

const SONGS = {
  'pioneer2-calm': {
    seconds: 100,
    prompt: `Video game soundtrack in the style of early-2000s European fairy-tale fantasy PC adventure games: warm, dreamy and magical. Home-village theme for the safe, cosy hub where the player rests and shops between adventures. Happy, gentle and whimsical with a sense of wonder, never sad, wistful or melancholic. G major, 92 BPM, a light lilting 6/8 feel. A soft wooden flute and pan pipes trading a simple friendly melody, fingerpicked acoustic guitar, harp arpeggios with the occasional sparkling glissando, warm pizzicato and legato strings, soft dreamy synth pads underneath, and very light hand percussion far back in the mix. Unobtrusive and evenly quiet so it sits pleasantly under gameplay, no big swells. ${NO} ${LOOP}`,
  },
  'forest-calm': {
    seconds: 100,
    prompt: `${ERA} Ambient exploration music for a lush, sunlit forest on an alien planet. Peaceful and airy, in D major. Soft sustained string and synth pads, slow sparse fingerpicked guitar and harp notes, and a distant breathy flute playing only a few long notes now and then. Ambient background music meant to sit unnoticed under gameplay: slow, soft, low-key and evenly quiet, with no drums, no beat, no prominent lead melody and no big swells. ${NO} ${LOOP}`,
  },
  'forest-battle': {
    seconds: 100,
    prompt: `${ERA} Combat theme for the same sunlit forest area. Same key (D major) and tempo (104 BPM) as the calm exploration theme. Upbeat, heroic and energetic: a bold french horn and trumpet melody, driving strings, a pumping bass guitar, acoustic guitar strums and a punchy but not overpowering drum kit. Exciting rather than threatening. ${NO} ${LOOP}`,
  },
  'dragon-calm': {
    seconds: 90,
    prompt: `${ERA} Boss battle theme against a huge fire dragon. Epic orchestral rock at 138 BPM in D minor: a heroic brass theme, driving string ostinatos, a choir holding long chords, timpani, and a tight rock drum kit with bass guitar. Urgent and heroic rather than horror. ${NO.replace(' or vocals', '')} Choir only as wordless "ah" pads. ${LOOP}`,
  },
  'dragon-battle': {
    seconds: 90,
    prompt: `${ERA} Final-phase boss battle theme against an enraged fire dragon. Same key (D minor) and tempo (138 BPM) as the main dragon fight theme, but more intense: fast 16th-note string runs, a full wordless choir, a soaring brass theme, taiko accents under a driving rock drum kit and bass guitar. Climactic and heroic rather than horror. No bells, chimes, glockenspiel, music box or dark synth drones. ${LOOP}`,
  },
  'derolle-calm': {
    seconds: 90,
    prompt: `${ERA} Boss battle theme against a giant armoured sea creature in a flooded underground lake. Tense and urgent orchestral rock at 150 BPM in E phrygian: a galloping bass guitar, palm-muted electric guitar riffs, fast staccato strings, stabbing brass and a driving drum kit, with a heroic lead melody on electric guitar and strings. Thrilling rather than creepy. ${NO} ${LOOP}`,
  },
  'derolle-battle': {
    seconds: 90,
    prompt: `${ERA} Second-phase boss battle theme against the same giant sea creature, now enraged. Same key (E phrygian) and tempo (150 BPM) as the first phase, but bigger: a wordless choir joins, taiko hits under the driving rock drums, long brass chords, galloping bass and electric guitar riffs, fast strings. Climactic and heroic rather than creepy. No bells, chimes, glockenspiel, music box or dark synth drones. ${LOOP}`,
  },
  'caves-calm': {
    seconds: 100,
    prompt: `${ERA} Ambient exploration music for the caves beneath an alien frontier planet: volcanic caverns and flooded grottos. Sci-fi, mysterious but calm and pleasant, never ominous or sad, in D dorian. Warm, slowly evolving analog synth pads, soft sparse Rhodes electric piano chords, deep fretless bass notes held long, and gentle airy textures. No tribal or hand drums, no marimba. Ambient background music meant to sit unnoticed under gameplay: slow, soft, low-key and evenly quiet, with no drums, no beat, no prominent lead melody and no big swells. ${NO} ${LOOP}`,
  },
  'caves-battle': {
    seconds: 100,
    prompt: `${ERA} Combat theme for the same alien caves. Same key (D dorian) and tempo (90 BPM) as the calm exploration theme. Futuristic sci-fi action, synth-orchestral: a driving synth bass line, staccato strings, warm synth pads, punchy electronic drums (tight kick and snare, sixteenth-note hi-hats) that sit back in the mix rather than dominate, and a confident heroic melody on a bright synth lead and strings. Exciting rather than threatening or scary. No tribal drums, hand drums, congas, taiko, marimba, acoustic guitar or jungle percussion. ${NO} ${LOOP}`,
  },
};

// Labelled alternatives, auditioned in the Sound Lab. These use a composition
// plan rather than a prompt: its negative styles are a real exclude list
// ("no bells" inside a prompt tends to summon bells instead).
const AMBIENT_EXCLUDE = [
  'bells', 'chimes', 'glockenspiel', 'celesta', 'music box', 'vibraphone', 'marimba', 'xylophone', 'kalimba',
  'tubular bells', 'bell-like synth tones', 'electric piano', 'Rhodes', 'piano', 'harp', 'plucked synth arpeggio',
  'drums', 'percussion', 'beat', 'tribal drums', 'taiko', 'hand drums', 'vocals', 'choir',
  'ominous', 'sad', 'melancholic', 'horror', 'dark drones', 'intro', 'outro', 'fade out', 'big crescendo',
];
const CAVES_AMBIENT = [
  'instrumental ambient video game background music', 'sci-fi exploration of caves on an alien planet',
  'calm, mysterious, pleasant and wondrous', 'D dorian', 'slow, soft and evenly quiet, sits unnoticed under gameplay',
  'one steady section that loops seamlessly',
];
const VARIANTS = {
  'caves-calm': [
    {
      key: 'A',
      note: 'Strings and pads: slow warm string ensemble, low cellos, warm analog pad, fretless bass.',
      seconds: 90,
      positive: [...CAVES_AMBIENT, 'slow warm string ensemble', 'low sustained cellos', 'warm analog synth pad', 'fretless bass holding long notes'],
      negative: AMBIENT_EXCLUDE,
    },
    {
      key: 'B',
      note: 'Ambient guitar: reverb-soaked, volume-swelled electric guitar over a warm pad and soft bass.',
      seconds: 90,
      positive: [...CAVES_AMBIENT, 'reverb-soaked volume-swelled clean electric guitar', 'warm analog synth pad', 'soft fretless bass'],
      negative: AMBIENT_EXCLUDE,
    },
    {
      key: 'C',
      note: 'Alto flute: a breathy alto flute with a few long notes over soft strings and a warm pad.',
      seconds: 90,
      positive: [...CAVES_AMBIENT, 'breathy alto flute playing a few long sustained notes', 'soft legato strings', 'warm analog synth pad', 'deep soft bass'],
      negative: AMBIENT_EXCLUDE,
    },
  ],
};

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const env = join(root, '.env');
  if (existsSync(env)) {
    const m = /^ELEVENLABS_API_KEY=(.*)$/m.exec(readFileSync(env, 'utf8'));
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error('ELEVENLABS_API_KEY is not set (see .env.example)');
}

/** Request body: a plain prompt, or a one-section composition plan with include / exclude styles. */
function body(song) {
  if (song.prompt) return { prompt: song.prompt, music_length_ms: song.seconds * 1000, model_id: 'music_v1', force_instrumental: true };
  return {
    model_id: 'music_v1',
    composition_plan: {
      positive_global_styles: song.positive,
      negative_global_styles: song.negative,
      sections: [{ section_name: 'Loop', positive_local_styles: [], negative_local_styles: [], duration_ms: song.seconds * 1000, lines: [] }],
    },
  };
}

async function generate(name, song, file, key, attempt = 0) {
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body(song)),
  });
  if (res.status === 429 && attempt < 5) {
    await res.text();
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    return generate(name, song, file, key, attempt + 1);
  }
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  console.log(`${name}: ${(buf.length / 1024).toFixed(0)} KB`);
}

/** Run jobs two at a time: the API caps concurrent requests per plan (2 on ours). */
async function runAll(jobs) {
  if (!jobs.length) return console.log('Nothing to generate (pass ids to regenerate).');
  const key = apiKey();
  const queue = [...jobs];
  let failed = 0;
  const worker = async () => {
    for (let job; (job = queue.shift()); ) {
      try {
        await generate(job.name, job.song, job.file, key);
      } catch (e) {
        failed++;
        console.error(String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
  if (failed) process.exitCode = 1;
}

const variantFile = (id, k) => join(varDir, `${id}.${k}.mp3`);
const usedPath = join(varDir, 'used.json');
const readUsed = () => (existsSync(usedPath) ? JSON.parse(readFileSync(usedPath, 'utf8')) : {});

/** index.json for the Sound Lab: every variant that has a file, and which one is in use. */
function writeIndex() {
  const used = readUsed();
  const index = Object.entries(VARIANTS)
    .map(([id, vs]) => ({
      id,
      used: used[id] ?? null,
      variants: vs
        .filter((v) => existsSync(variantFile(id, v.key)))
        .map((v) => ({ key: v.key, note: v.note, file: `music/variants/${id}.${v.key}.mp3` })),
    }))
    .filter((e) => e.variants.length);
  writeFileSync(join(varDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

const args = process.argv.slice(2);
mkdirSync(varDir, { recursive: true });
if (args[0] === '--use') {
  const [, id, k] = args;
  if (!existsSync(variantFile(id, k))) throw new Error(`no variant file ${id}.${k}.mp3`);
  copyFileSync(variantFile(id, k), join(outDir, `${id}.mp3`));
  writeFileSync(usedPath, JSON.stringify({ ...readUsed(), [id]: k }, null, 2) + '\n');
  writeIndex();
  console.log(`${id}: now playing variant ${k}`);
} else if (args[0] === '--variants') {
  const ids = args.slice(1);
  for (const id of ids) if (!VARIANTS[id]) throw new Error(`no variants for ${id} (have: ${Object.keys(VARIANTS).join(', ')})`);
  const jobs = (ids.length ? ids : Object.keys(VARIANTS)).flatMap((id) =>
    VARIANTS[id]
      .filter((v) => !existsSync(variantFile(id, v.key)))
      .map((v) => ({ name: `${id}.${v.key}`, song: v, file: variantFile(id, v.key) })),
  );
  await runAll(jobs);
  writeIndex();
} else {
  for (const id of args) if (!SONGS[id]) throw new Error(`unknown id ${id} (have: ${Object.keys(SONGS).join(', ')})`);
  const todo = args.length ? args : Object.keys(SONGS).filter((id) => !existsSync(join(outDir, `${id}.mp3`)));
  await runAll(todo.map((id) => ({ name: id, song: SONGS[id], file: join(outDir, `${id}.mp3`) })));
}
