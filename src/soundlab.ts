import { initAudio, music, sfx, type SfxId } from './audio';
import { engine } from './audio/engine';
import { LEVEL_TARGET } from './audio/levels';
import { TRACKS, type TrackId } from './audio/music/tracks';
import { labPicks, pickOf, setLabPicks, SOUND_PICKS } from './audio/picks';
import { SFX, SFX_GROUPS, type SfxDef } from './audio/sfx';
import type { V } from './audio/synth';

// Sound Lab: every sound effect with its variants (click to hear, "pick" to
// choose the one the game plays) and every music track with a calm / battle
// toggle. Picks are stored in this browser right away (the game picks them up
// live); the bar at the bottom shows them as code to bake into picks.ts.

initAudio();
const app = document.getElementById('app')!;
const bar = document.getElementById('bar')!;
const gate = document.getElementById('gate')!;
gate.addEventListener('click', () => gate.remove());

let playing: TrackId | null = null;
let battle = false;
const levels = new Map<string, string>();
const ids = Object.keys(SFX) as SfxId[];
const LETTERS = 'ABCDEF';

/** Generated music alternatives (public/music/variants/index.json, written by `npm run music -- --variants`). */
interface MusicVariants {
  id: string;
  used: string | null;
  variants: { key: string; note: string; file: string }[];
}
let musicVariants: MusicVariants[] = [];
fetch(`${import.meta.env.BASE_URL}music/variants/index.json`, { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : []))
  .then((v: MusicVariants[]) => {
    musicVariants = v;
    render();
  })
  .catch(() => {});

function render(): void {
  const picks = labPicks();
  const tracks = (Object.values(TRACKS) as (typeof TRACKS)[TrackId][])
    .map(
      (t) => `<div class="track${playing === t.id ? ' playing' : ''}">
        <b>${t.name}</b> <span class="hint">${t.bpm} BPM · ${t.bars} bars</span>
        <p>${t.desc}</p>
        <button data-act="play" data-arg="${t.id}">${playing === t.id ? '■ Stop' : '▶ Play'}</button>
        <button data-act="battle" class="${playing === t.id && battle ? 'on' : ''}">${playing === t.id && battle ? 'Battle / enraged' : 'Calm'} ⇄</button>
      </div>`,
    )
    .join('');

  const variants = musicVariants
    .map(
      (m) => `<div class="row"><div><div class="name">${m.id}</div><div class="id">in game: ${m.used ? `variant ${m.used}` : 'original'}</div></div>
        <div class="vars">${m.variants
          .map(
            (v) => `<div class="mvar${m.used === v.key ? ' on' : ''}"><b>${v.key}</b> ${v.note}${m.used === v.key ? ' <small>✓ in game</small>' : ''}
              <audio controls loop preload="none" src="${import.meta.env.BASE_URL}${v.file}"></audio></div>`,
          )
          .join('')}</div></div>`,
    )
    .join('');

  const groups = SFX_GROUPS.map((g) => {
    const rows = ids
      .filter((id) => SFX[id].group === g)
      .map((id) => {
        const def: SfxDef = SFX[id];
        const cur = pickOf(id);
        const vars = def.variants
          .map(
            (v, i) => `<div><button class="var${cur === i ? ' on' : ''}" data-act="sfx" data-arg="${id}|${i}">
              <b>${LETTERS[i]}</b>${v.name}<small>${v.desc}</small>${levels.has(`${id}|${i}`) ? `<span class="lvl">${levels.get(`${id}|${i}`)}</span>` : ''}</button>
              ${def.variants.length > 1 ? `<br><button class="pick${cur === i ? ' on' : ''}" data-act="pick" data-arg="${id}|${i}">${cur === i ? '✓ picked' : 'pick'}</button>` : ''}</div>`,
          )
          .join('');
        return `<div class="row"><div><div class="name">${def.label}</div><div class="id">${id}</div></div><div class="vars">${vars}</div></div>`;
      })
      .join('');
    return `<h2>${g}</h2>${rows}`;
  }).join('');

  app.innerHTML = `<h1>Sound Lab</h1>
    <div class="hint">Every sound is synthesized in code. Click a variant to hear it, <b>pick</b> to use it in the game
    (the game picks it up live, in this browser). Music: play a track and flip Calm ⇄ Battle to hear the crossfade.
    <button data-act="measure">Measure loudness</button></div>
    <h2>Music</h2><div class="tracks">${tracks}</div>
    ${variants ? `<h2>Music variants</h2><div class="hint">Generated alternatives. Listen, then tell Claude which letter to use
    (it runs <code>npm run music -- --use &lt;id&gt; &lt;letter&gt;</code>).</div>${variants}` : ''}${groups}`;

  const changed = ids.filter((id) => picks[id] !== undefined && picks[id] !== (SOUND_PICKS[id] ?? 0));
  const code = `{ ${ids.filter((id) => pickOf(id) !== 0).map((id) => `'${id}': ${pickOf(id)}`).join(', ')} }`;
  bar.innerHTML = changed.length
    ? `<span>${changed.length} pick${changed.length > 1 ? 's' : ''} changed:</span> <code>${changed.map((id) => `${id} → ${LETTERS[pickOf(id)]}`).join(', ')}</code>
       <button data-act="copy" data-arg="${encodeURIComponent(code)}">Copy SOUND_PICKS</button> <button data-act="reset">Reset to baked-in</button>`
    : `<span class="hint">No changes from the baked-in picks (src/audio/picks.ts).</span>`;
}

document.body.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const [a, b] = (t.dataset.arg ?? '').split('|');
  switch (t.dataset.act) {
    case 'play':
      if (playing === a) {
        music.stop(0.8);
        playing = null;
      } else {
        playing = a as TrackId;
        music.play(playing, { battle });
      }
      break;
    case 'battle':
      battle = !battle;
      music.setBattle(battle);
      break;
    case 'sfx':
      engine.whenRunning(() => sfx(a as SfxId, { variant: Number(b), arg: SFX[a as SfxId].x ?? 1.5 }));
      break;
    case 'pick': {
      const p = { ...labPicks(), [a]: Number(b) };
      setLabPicks(p);
      engine.whenRunning(() => sfx(a as SfxId, { variant: Number(b), arg: SFX[a as SfxId].x ?? 1.5 }));
      break;
    }
    case 'reset':
      setLabPicks({});
      break;
    case 'copy':
      void navigator.clipboard?.writeText(`export const SOUND_PICKS: Partial<Record<SfxId, number>> = ${decodeURIComponent(t.dataset.arg!)};`);
      t.textContent = 'Copied!';
      return;
    case 'measure':
      void measureAll();
      return;
  }
  render();
});

/** Render every variant offline and show its peak and loudest 50 ms RMS (dBFS). */
async function measureAll(): Promise<void> {
  const rate = 22050;
  const trims: Record<string, number> = {};
  for (const id of ids) {
    const def: SfxDef = SFX[id];
    for (let i = 0; i < def.variants.length; i++) {
      const len = Math.min(8, (def.len ?? 3) + 1);
      const ctx = new OfflineAudioContext(1, Math.ceil(rate * len), rate);
      const v: V = { ctx, out: ctx.destination, wet: null, t: 0.01, p: 1 };
      def.variants[i].play(v, def.x ?? 1.5);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      let best = 0;
      const win = Math.floor(rate * 0.05);
      for (let s = 0; s + win <= d.length; s += win >> 1) {
        let sum = 0;
        for (let k = s; k < s + win; k++) sum += d[k] * d[k];
        best = Math.max(best, sum / win);
      }
      for (const x of d) peak = Math.max(peak, Math.abs(x));
      const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      const rms = db(Math.sqrt(best));
      const trim = isFinite(rms) ? Math.max(-18, Math.min(18, LEVEL_TARGET[id] - rms)) : 0;
      trims[`${id}|${i}`] = Math.round(trim);
      levels.set(`${id}|${i}`, `raw peak ${db(peak).toFixed(0)} · rms ${rms.toFixed(0)} dB → trim ${trim > 0 ? '+' : ''}${trim.toFixed(0)}`);
    }
  }
  const lines = Object.entries(trims)
    .filter(([, t]) => t !== 0)
    .map(([k, t]) => `  '${k}': ${t},`);
  const code = ['export const LEVEL_TRIM: Record<string, number> = {', ...lines, '};'].join('\n');
  Object.assign(window, { soundLevels: Object.fromEntries(levels), levelTrimCode: code });
  console.info(code);
  render();
}

render();
