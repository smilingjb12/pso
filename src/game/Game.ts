import * as THREE from 'three';
import type GUI from 'lil-gui';
import { initAudio, music, setListener, setMuffled, setSpace, sfx, type SfxId } from '../audio';
import { Input } from '../engine/Input';
import { Hud, type ContextView, type HudState, type PaletteSlotView } from '../ui/Hud';
import { itemIcon, techIcon, weaponIcon } from '../ui/icons';
import { createDebugPanel } from '../ui/debugPanel';
import {
  ChoiceMenu,
  esc,
  InventoryMenu,
  MenuLayer,
  ShopMenu,
  type ChoiceOption,
  type GameApi,
  type Menu,
} from '../ui/Menus';
import { StylistMenu } from '../ui/stylist';
import { nightmareOpen, TitleMenu, type Difficulty } from '../ui/title';
import { AudioCues } from './audioCues';
import { CameraRig } from './CameraRig';
import { Character, dropVerdict, itemName, makeItem, sellPrice, type DropVerdict, type GrindTrack, type ItemInstance } from './character';
import { angleDelta, yawTo } from './collision';
import { Combat } from './combat/Combat';
import type { Hittable } from './combat/types';
import type { ComboEvent } from './combo';
import { expeditionFoe, type Foe } from './dps';
import { affixes as affixCfg, hard as hardCfg, camera as camCfg, comboDamage, dash as dashCfg, debug, formulas, injectorCfg, lockOn, magCfg, player as playerCfg, pylonCfg, telepipeCfg, type AttackType } from './config';
import { AFFIXES } from './data/affixes';
import { areas, DEFAULT_LIGHT, expeditionOf, expeditionOfBoss, expeditionOpenedBy, expeditions, isCounter, type AreaId, type ExpeditionId } from './data/areas';
import { BOSS_IDS, BOSSES, type BossDef } from './data/bosses';
import { areaDef } from './data/looks';
import { type AttributeId, type KitId, type PaletteEdit, type PaletteRow, type QuickAction } from './data/stats';
import { ATTR_LABEL, getDef, INJECTOR_MODS, specials, type WeaponKind } from './data/items';
import { isAttackTech, techniques } from './data/techniques';
import { Enemy, type EnemyContext } from './enemies/Enemy';
import {
  buyPrice, rollBoxDrop, rollBossDrops, rollChampionBonus, rollEliteBonus, rollEnemyDrop, rollRare, rollWeapon,
  shopStock, type Drop, type ShopKind, type ShopUnlocks,
} from './loot';
import { addCharge, chargeOf, doseAmount, fillInjector, injectorDef, injectorStats, spendDose } from './injectors';
import { learnCells, magForm } from './mag';
import { playerLook } from './models/heroine';
import { Player } from './Player';
import { deleteSlot, listSlots, saveSlot } from './save';
import { Breakable } from './world/Breakable';
import { Atmosphere } from './world/Atmosphere';
import { DashTrail, Lob, Pillar, Ring, Tracer } from './world/Effects';
import { inShape, type Telegraph } from './world/Telegraph';
import { Interactable } from './world/Interactable';
import type { Pickup } from './world/Pickup';
import { newRun, World, type RunState } from './world/World';

/** LMB / RMB: the row's attack source (heavy single target / light area); Q / E: its quick slots. */
const SLOT_KEYS = ['Mouse0', 'Mouse2', 'KeyQ', 'KeyE'] as const;
const SLOT_KEY_LABELS = ['LMB', 'RMB', 'Q', 'E'];
const DROP_MARK: Record<DropVerdict['mark'], string> = { '': '', up: '▲', down: '▼', same: '=', no: '✖' };

type SpawnAt = 'start' | { x: number; z: number };

/** Stand-in when there is no world to show a telegraph in. */
const noTelegraph = { cancel: () => {} };

/** Each weapon kind's attack sound: a shot for guns, a whoosh for blades, a heavier one for staves. */
const ATTACK_SFX: Record<WeaponKind, SfxId> = {
  saber: 'swing.blade', sword: 'swing.blade', dagger: 'swing.blade', partisan: 'swing.blade',
  cane: 'swing.blunt', rod: 'swing.blunt', wand: 'swing.blunt',
  handgun: 'shot.handgun', rifle: 'shot.rifle', mechgun: 'shot.mechgun', shot: 'shot.shot', slicer: 'shot.slicer',
};

/** Seconds of field play between periodic autosaves. */
const AUTOSAVE_PERIOD = 60;
/** Seconds an affix's description stays in the enemy frame before the character has learned it. */
/** Minimum seconds between event-driven autosaves. */
const AUTOSAVE_GAP = 2;

export class Game implements GameApi {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private input: Input;
  private rig: CameraRig;
  private atmosphere: Atmosphere;
  private hud: Hud;
  private menus: MenuLayer;
  private gui: GUI;
  private rng = Math.random;
  private combat: Combat;

  char: Character = Character.create('Nobody', 'vanguard');
  private slot = -1;
  // Autosave: the character is written after important events (throttled),
  // every AUTOSAVE_PERIOD seconds in the field, and when the page is hidden.
  private lastSaveAt = -Infinity;
  private savePending = false;
  private saveClock = 0;
  private saveFailed = false;
  private player: Player;
  private world: World | null = null;
  /** The run of the expedition you're in (or were last in). */
  private run: RunState = newRun();
  /** This session's run of each expedition: each keeps its own progress until its boss falls, or you log out. */
  private runs: Partial<Record<ExpeditionId, RunState>> = {};
  /** Session difficulty, picked at login: Nightmare (the run state's `hard` flag) for every expedition. */
  private hard = false;
  /** The open Telepipe: where its field end stands. Both ends close once you come back through it. */
  private telepipe: { area: AreaId; x: number; z: number } | null = null;
  /** The portal object in the current world, if this area shows one end of the Telepipe. */
  private portal: Interactable | null = null;
  /** Boss HP last frame (damage to the boss charges injectors). */
  private bossHpSeen = -1;
  /** Seconds since the last fight ended (out-of-combat injector recharge starts after injectorCfg.calmDelay). */
  private calmT = 0;
  private stock: Record<ShopKind, ItemInstance[]> = { weapon: [], armor: [], item: [] };
  private playing = false;

  private last = performance.now();
  private hitstop = 0;
  private lockTarget: Hittable | null = null;
  /** Space went down and hasn't dashed yet (it waits for a direction while held). */
  private dashArmed = false;
  /** Enemy telegraphs the current dash started in (Slipstream checks them when it ends). */
  private slipFrom: Telegraph[] | null = null;
  /** The swing that just started lands perfect (Slipstream): its hit gets one more streak step. */
  private slipHit = false;
  private lastDashHint = -Infinity;
  private lastHit: Hittable | null = null;
  private lastHitT = 0;
  /** Level, Mag and worn gear the drops' verdicts were read against; they are re-read when it changes. */
  private dropKey = '';
  private roomInfo: string | null = null;
  private deathT = -1;
  private playAcc = 0;
  private moveDir = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private enemyCtx: EnemyContext;
  private cues = new AudioCues();
  private wasInWindow = false;
  private muffled = false;
  private bossMusic = false;
  /** Counts down after a boss kill, then the area's music comes back. */
  private victoryT = -1;
  /** Seconds each not-yet-learned affix has been shown in the enemy frame. */

  constructor(container: HTMLElement) {
    initAudio();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(camCfg.fov, window.innerWidth / window.innerHeight, 0.1, 300);
    const saveOnLeave = () => {
      if (this.playing) this.save();
    };
    window.addEventListener('pagehide', saveOnLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveOnLeave();
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.atmosphere.resize(window.innerWidth, window.innerHeight);
    });
    this.atmosphere = new Atmosphere(this.renderer, this.scene, this.camera);

    this.hemi = new THREE.HemisphereLight(DEFAULT_LIGHT.hemiSky, DEFAULT_LIGHT.hemiGround, DEFAULT_LIGHT.hemi);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.far = 120;
    this.scene.add(this.sun, this.sun.target);

    this.player = new Player(this.char);
    this.scene.add(this.player.group);

    this.rig = new CameraRig(this.camera, (from, dir, max) => this.world?.level.raycast(from, dir, max) ?? max);
    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(container);
    this.hud.visible = false;
    this.menus = new MenuLayer(container);

    this.input.onLockChange = () => this.updateOverlay();
    container.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lil-gui') || t.closest('.menu-layer')) return;
      if (this.playing && !this.menus.isOpen && !this.input.locked) this.input.requestLock();
    });

    this.combat = new Combat({
      world: () => this.world!,
      player: () => this.player,
      char: () => this.char,
      lockTarget: () => this.lockTarget,
      moveDir: () => this.moveDir,
      float: (p, t, c) => this.hud.float(p, t, c),
      log: (h) => this.hud.pushLog(h),
      hitstop: (s) => (this.hitstop = Math.max(this.hitstop, s)),
      shake: (m) => this.rig.shake(m),
      onKill: (t) => this.onKill(t),
      onHit: (t) => {
        this.lastHit = t;
        this.lastHitT = 0;
      },
      onDamage: (t, dealt) => this.chargeFromDamage(t, dealt),
      onPlayerHurt: () => this.onPlayerHurt(),
      onLastStand: () => this.lastStandDose(),
      rng: this.rng,
    });

    this.enemyCtx = {
      playerX: 0,
      playerZ: 0,
      playerAlive: true,
      requestAttackToken: (e, w) => this.world?.requestAttackToken(e, w) ?? false,
      requestShot: (e, w) => this.world?.requestShot(e, w) ?? false,
      tryStrike: (e) => this.combat.enemyStrike(e),
      onDot: (e, d, kind) => this.combat.burnTick(e, d, kind),
      telegraph: (shape, dur, onFire, color) => this.world?.addTelegraph(shape, dur, onFire, color) ?? noTelegraph,
      areaStrike: (e, shape, mult, kb, status, chance) => {
        // Molten: wherever its area attacks land, the ground burns.
        if (e.hasAffix('molten')) this.world?.moltenMark(shape);
        return this.combat.enemyArea(e, shape, mult, kb, status, chance);
      },
      lob: (from, x, z, dur, color) => {
        this.world?.addEffect(new Lob(from, x, z, dur, color));
        sfx('lily.spit', { x: from.x, z: from.z });
        setTimeout(() => sfx('lily.splat', { x, z }), dur * 1000);
      },
      bolt: (x, z, color) => {
        sfx('enemy.lightning', { x, z });
        this.world?.addEffect(new Pillar(x, z, color));
        this.world?.addEffect(new Ring(x, z, color, 2.4));
      },
      blast: (src, x, z, r) => {
        sfx('missile.explode', { x, z });
        this.world?.addEffect(new Ring(x, z, 0xff8a40, r * 1.2, 0.35));
        this.world?.addEffect(new Pillar(x, z, 0xff8a40, 0.25, 0.6, 3));
        this.world?.blast(src, x, z, r);
      },
      missile: (from, x, z, dur) => {
        this.world?.addEffect(new Lob(from, x, z, dur, 0xffa050, 0.22));
        sfx('garanz.launch', { x: from.x, z: from.z });
      },
      tracer: (x, z, yaw, len, color) => this.world?.addEffect(new Tracer(x, z, yaw, len, color)),
      firePatch: (x, z, r, life) => this.world?.addFirePatch(x, z, r, life),
      healed: (e, amount) => this.hud.float(this.tmpA.copy(e.pos).setY(e.aimHeight + 0.6), `+${amount}`, 'heal'),
      boom: (x, z, r, color) => {
        sfx('missile.explode', { x, z });
        this.world?.addEffect(new Ring(x, z, color, r * 1.15, 0.4));
        this.world?.addEffect(new Pillar(x, z, color, 0.3, 0.9, 4));
      },
      blinkSpot: (e, x, z, d) => this.world?.blinkSpot(e, x, z, d) ?? null,
      reach: (x, z, yaw, max) => this.world?.reach(x, z, yaw, max) ?? max,
      litPylon: (e) => this.world?.litPylon(e) ?? null,
      snuffPylon: (id, k) => this.world?.snuffPylon(id, k),
      blinkFx: (x, z) => {
        this.world?.addEffect(new Ring(x, z, 0xa040ff, 1.6, 0.3));
        this.world?.addEffect(new Pillar(x, z, 0x8030d0, 0.25, 0.7, 4));
      },
      rng: this.rng,
    };

    this.gui = createDebugPanel({
      giveXp: (n) => this.gainXp(n),
      giveMeseta: (n) => {
        this.char.data.meseta += n;
      },
      giveWeapon: () => this.giveItem(rollWeapon(1 + Math.floor(this.rng() * 3), this.rng, this.char.lootBias())),
      giveRare: () => this.giveItem(rollRare(this.rng)),
      heal: () => {
        this.player.fullRestore();
        this.refillInjectors();
      },
      killAll: () => this.debugKillAll(),
      goto: (a) => this.enterArea(a, 'start'),
      unlock: (exp) => {
        // Every boss on the way there counts as beaten.
        for (let need = expeditions[exp].needs; need; need = expeditions[expeditionOfBoss(need)].needs) {
          this.char.data.stats.bossKills[need] = Math.max(1, this.char.bossKills(need, false));
        }
        this.hud.toast(`The ${expeditions[exp].name} are unlocked for this character.`, 'good');
      },
      unlockHard: () => {
        const st = this.char.data.stats;
        st.hardKills ??= {};
        for (const id of BOSS_IDS) {
          st.bossKills[id] = Math.max(1, this.char.bossKills(id, false));
          st.hardKills[id] = Math.max(1, this.char.bossKills(id, true));
        }
        this.hud.toast('Nightmare is unlocked for this character (every expedition): pick it at login.', 'good');
      },
    });
    this.gui.hide();
    let guiVisible = false;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Backquote') {
        guiVisible = !guiVisible;
        this.gui.show(guiVisible);
      } else if (e.code === 'Escape' && this.menus.isOpen && this.menus.menu?.closable) {
        this.closeMenu();
      } else if (e.code === 'KeyI' && this.playing) {
        if (this.menus.menu instanceof InventoryMenu) this.closeMenu();
        else if (!this.menus.isOpen && this.player.alive) this.openMenu(new InventoryMenu(this));
      }
    });

    this.openTitle();
  }

  start(): void {
    const frame = (now: number) => {
      this.frame(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ================================================================ flow

  private get paused(): boolean {
    return !this.playing || this.menus.isOpen || !this.input.locked;
  }

  get inField(): boolean {
    return !!this.world && this.world.def.kind !== 'city';
  }

  private openTitle(): void {
    this.playing = false;
    music.play('pioneer2', { battle: false });
    this.hud.visible = false;
    this.hud.showOverlay(null);
    this.menus.open(
      new TitleMenu({
        slots: () => listSlots(),
        load: (slot, difficulty) => {
          const data = listSlots()[slot];
          if (data) this.startCharacter(slot, new Character(data), difficulty);
        },
        create: (slot, name, kit: KitId, appearance) => {
          const ch = Character.create(name, kit, appearance);
          saveSlot(slot, ch.data);
          this.startCharacter(slot, ch);
        },
        remove: (slot) => deleteSlot(slot),
      }),
    );
  }

  private startCharacter(slot: number, ch: Character, difficulty: Difficulty = 'normal'): void {
    this.slot = slot;
    this.char = ch;
    this.hard = difficulty === 'nightmare' && nightmareOpen(ch.data);
    this.player.setCharacter(ch);
    this.runs = {};
    this.run = newRun('forest', this.hard);
    this.telepipe = null;
    this.deathT = -1;
    this.player.resetState();
    this.player.clearBuffs();
    this.playing = true;
    this.hud.visible = true;
    this.menus.close();
    this.enterArea('city', 'start');
    this.input.requestLock();
    if (ch.refunded) this.hud.toast('The attribute and Mag rules changed: every point is back to spend again (Menu → Status and Mag).', 'good');
  }

  private openMenu(menu: Menu): void {
    this.menus.open(menu);
    if (document.pointerLockElement) document.exitPointerLock();
    this.updateOverlay();
  }

  closeMenu(): void {
    if (!this.menus.isOpen) return;
    this.menus.close();
    this.player.refreshLook();
    this.player.refreshWeapon();
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.player.tp = Math.min(this.player.tp, this.player.maxTp);
    if (this.player.alive) this.autosave();
    if (this.playing) this.input.requestLock();
    this.updateOverlay();
  }

  private updateOverlay(): void {
    if (!this.playing || this.menus.isOpen || this.input.locked) this.hud.showOverlay(null);
    else this.hud.showOverlay(`<div class="panel win"><div class="win-title">Paused</div><p class="resume">Click to resume</p>
      <table class="controls">
        <tr><td>WASD</td><td>Move</td><td>Mouse</td><td>Camera</td></tr>
        <tr><td>LMB / RMB</td><td>Single-target / area attack</td><td>Q / E</td><td>Quick slots</td></tr>
        <tr><td>Wheel</td><td>Choose attack technique</td><td>Shift (hold)</td><td>Palette 2</td></tr>
        <tr><td>Space + WASD</td><td>Dash</td><td>R / Space</td><td>Talk / pick up / use</td></tr>
        <tr><td>F</td><td>Lock-on</td><td>1 / 2</td><td>Injectors</td></tr>
        <tr><td>Tab</td><td>Cycle target</td><td>C</td><td>Camera behind</td></tr>
        <tr><td>I</td><td>Menu</td><td>Esc</td><td>Pause</td></tr>
      </table>
      <p class="dim">${this.saveAgo()} · \` toggles the tuning panel</p></div>`);
  }

  private saveAgo(): string {
    if (this.saveFailed) return '<span class="bad">Saving unavailable</span>';
    if (!isFinite(this.lastSaveAt)) return 'Not saved yet';
    const s = Math.round((performance.now() - this.lastSaveAt) / 1000);
    return `Autosaved ${s < 60 ? `${s} s` : `${Math.round(s / 60)} min`} ago`;
  }

  quitToTitle(): void {
    this.save();
    this.menus.close();
    if (document.pointerLockElement) document.exitPointerLock();
    this.openTitle();
  }

  /** Write the character to its slot now. */
  private save(): boolean {
    if (this.slot < 0) return false;
    const ok = saveSlot(this.slot, this.char.data);
    if (ok) {
      this.lastSaveAt = performance.now();
      this.saveClock = 0;
      this.savePending = false;
      this.hud.saveBlip();
    } else if (!this.saveFailed) {
      this.saveFailed = true;
      this.hud.toast('Could not save: browser storage is unavailable. Progress will be lost on reload.', 'warn');
    }
    return ok;
  }

  /** Ask for a save soon. Saves are spaced at least AUTOSAVE_GAP apart and wait while the player is down. */
  private autosave(): void {
    this.savePending = true;
  }

  private tickAutosave(realDt: number): void {
    if (!this.playing || this.slot < 0) return;
    const down = !this.player.alive || this.deathT >= 0;
    if (this.inField && !this.paused) {
      this.saveClock += realDt;
      if (this.saveClock >= AUTOSAVE_PERIOD) this.savePending = true;
    }
    if (this.savePending && !down && performance.now() - this.lastSaveAt > AUTOSAVE_GAP * 1000) this.save();
  }

  // ============================================================== areas

  private enterArea(id: AreaId, spawn: SpawnAt): void {
    if (this.world) {
      this.world.resetActiveRoom();
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    const def = areaDef(id);
    const exp = expeditionOf(id);
    if (exp) {
      // Every floor reached is a checkpoint: the furthest one is where the city teleporter brings you back.
      this.run = this.runOf(exp);
      this.run.floor = Math.max(this.run.floor, expeditions[exp].floors.indexOf(id));
    }
    const run = def.kind === 'city' ? newRun('forest', this.hard) : this.run;
    this.world = new World(id, run, {
      enemyCtx: this.enemyCtx,
      bossCtx: {
        playerX: 0,
        playerZ: 0,
        playerAlive: true,
        rng: this.rng,
        telegraph: (shape, dur, onFire, color, dash) => {
          if (dash) this.dashHint();
          return this.world?.addTelegraph(shape, dur, onFire, color, dash) ?? noTelegraph;
        },
        hitPlayer: (shape, mult, fx, fz, kb, status, chance) =>
          !!this.world?.boss && this.combat.bossHit(this.world.boss, shape, mult, fx, fz, kb, status, chance),
        tickPlayer: (shape, dmg, fx, fz) => this.combat.bossTick(shape, dmg, fx, fz),
        puddle: (x, z, r, life) => this.world?.addPuddle(x, z, r, life),
        hazardHit: (dmg, fx, fz, kb, source) => this.combat.hazardHurt(dmg, fx, fz, kb, source),
        burnPlayer: (n) => this.combat.applyPlayerStatus('burn', n),
        paralyse: (chance) => {
          if (this.rng() < chance) this.combat.applyPlayerStatus('paralysis');
        },
        corruptPlayer: (n) => this.combat.applyPlayerStatus('corrupt', n),
        body: () => this.player,
        spawnAdd: (type, x, z) => this.world!.spawnEnemy(type, x, z, null, { noReward: true }),
        effect: (e) => this.world?.addEffect(e),
        shake: (m) => this.rig.shake(m),
        announce: (t) => this.hud.banner(t, 'boss'),
        // Enraged / shattered / overclocked phases (and the Angel) bring in the boss track's battle layer.
        escalate: () => music.setBattle(true),
        isSolid: (x, z) => this.world?.level.isSolidAt(x, z) ?? true,
      },
      hazards: {
        hurtPlayer: (dmg, fx, fz, kb, source) => this.combat.hazardHurt(dmg, fx, fz, kb, source),
        poisonPlayer: (sec) => this.combat.applyPlayerStatus('poison', sec),
        burnPlayer: (n) => this.combat.applyPlayerStatus('burn', n),
        hurtEnemy: (e, dmg) => this.combat.burnTick(e, dmg, 'burn', false),
      },
      onEnemyKilled: (e) => this.onKill(e),
      volatileBlast: (e, shape) => {
        sfx('missile.explode', { x: shape.x, z: shape.z, pitch: 0.8 });
        this.rig.shake(0.2);
        if (this.combat.enemyArea(e, shape, affixCfg.volatileAtpMult, 8)) this.combat.applyPlayerStatus('burn', affixCfg.volatileBurn);
      },
      onRoomActivated: () => {
        this.hud.toast('Enemies approaching — the gates are sealed!', 'warn');
        sfx('gate.close');
        music.setBattle(true);
      },
      onWave: (_r, n, total, ambush) => {
        this.roomInfo = `Wave ${n}/${total}`;
        if (ambush) {
          this.hud.toast('Ambush! Enemies are dropping in behind you!', 'warn');
          sfx('enemy.ambush');
        }
      },
      onRoomCleared: () => {
        this.roomInfo = null;
        this.cleanse();
        this.hud.toast('Room cleared. The gates open.', 'good');
        sfx('gate.open');
        sfx('jingle.clear');
        music.setBattle(false);
      },
      onEvent: (text) => this.hud.pushLog(`<span class="l-proc">${text}</span>`),
      rng: this.rng,
    });
    const boss = this.world.boss;
    if (boss) boss.onDot = (t, d) => this.combat.burnTick(t, d);
    this.scene.add(this.world.group);
    this.atmosphere.apply(def.theme);
    // Under bloom the photon blade would blow out to a white blur: dim it there.
    this.player.photonScale = def.theme.bloom ? 0.6 : 1;
    const light = def.theme.light ?? DEFAULT_LIGHT;
    this.hemi.color.set(light.hemiSky);
    this.hemi.groundColor.set(light.hemiGround);
    this.hemi.intensity = light.hemi;
    this.sun.color.set(light.sunColor);
    this.sun.intensity = light.sun;

    let pos = this.world.startPoint();
    if (typeof spawn === 'object') pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.player.pos.copy(pos);
    this.player.resetState();
    this.portal = null;
    this.bossHpSeen = -1;
    this.placePortal();
    // Only Pioneer 2 tops every injector up.
    if (def.kind === 'city') this.refillInjectors();
    this.player.yaw = def.kind === 'boss' || def.kind === 'city' ? Math.PI : 0;
    if (def.startYaw !== undefined && spawn === 'start') this.player.yaw = def.startYaw;
    this.rig.snapBehind(this.player.yaw);
    this.rig.teleport();
    this.lockTarget = null;
    this.lastHit = null;
    this.roomInfo = null;
    this.hud.clearFloats();
    this.hud.banner(run.hard ? `${def.name} (Nightmare)` : def.name);
    this.playAreaMusic();
    setSpace(areas[id].audio.space);

    if (def.kind === 'city') {
      // Bosses beaten open shop tiers (BOSSES[id].shop / hardShop).
      const u: ShopUnlocks = { hard: {} };
      for (const id of BOSS_IDS) {
        u[id] = this.char.bossKills(id, false) > 0;
        u.hard![id] = this.char.bossKills(id, true) > 0;
      }
      this.stock = {
        weapon: shopStock('weapon', this.char.level, this.char.lootBias(), this.rng, u),
        armor: shopStock('armor', this.char.level, this.char.lootBias(), this.rng, u),
        item: shopStock('item', this.char.level, this.char.lootBias(), this.rng, u),
      };
      this.player.clearBuffs();
      this.save();
    }
  }

  /** The area's track (calm). Boss arenas stay quiet until the boss wakes, and play the expedition's theme once it's beaten. */
  private playAreaMusic(): void {
    const world = this.world;
    if (!world) return;
    const au = areas[world.areaId].audio;
    this.bossMusic = false;
    this.victoryT = -1;
    music.play(au.track ?? (this.run.bossDefeated && au.after ? au.after : null), { battle: world.roomActive });
  }

  /** This session's run of `exp`, started fresh the first time. */
  private runOf(exp: ExpeditionId): RunState {
    return (this.runs[exp] ??= newRun(exp, this.hard));
  }

  /** Start `exp` over from its first floor (a fresh run). */
  private newExpedition(exp: ExpeditionId, hard = this.hard): void {
    this.runs[exp] = newRun(exp, hard);
    if (this.telepipe && expeditionOf(this.telepipe.area) === exp) {
      this.hud.toast('Your Telepipe closed: the expedition starts fresh.', 'warn');
      this.telepipe = null;
    }
    this.enterArea(expeditions[exp].floors[0], 'start');
  }

  /** The city teleporter: back to the furthest floor reached, or a fresh run once the boss has fallen. */
  private resumeExpedition(exp: ExpeditionId): void {
    const r = this.runs[exp];
    if (!r || r.bossDefeated) this.newExpedition(exp);
    else this.enterArea(expeditions[exp].floors[r.floor], 'start');
  }

  /** Take a floor teleporter deeper. A Telepipe left open on an earlier floor would lead behind you, so it closes. */
  private goDeeper(dest: AreaId): void {
    if (this.telepipe && expeditionOf(this.telepipe.area) === this.run.expedition) {
      this.telepipe = null;
      this.hud.toast('Your Telepipe closed as you went deeper.', 'warn');
    }
    this.enterArea(dest, 'start');
  }

  // ============================================================== frame

  private frame(now: number): void {
    // Clamped at 0 too: a clock that steps backwards (scripted frames mixed with rAF) must not rewind anything.
    const realDt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.tickAutosave(realDt);

    if (!this.paused && this.world) {
      this.rig.orbit(this.input.mouseDX, this.input.mouseDY);
      this.handleInput();

      let dt = realDt * debug.timeScale;
      if (this.hitstop > 0) {
        this.hitstop -= realDt;
        dt = 0;
      }
      if (dt > 0) this.update(dt);
      this.playAcc += realDt;
      if (this.playAcc >= 1) {
        this.char.data.stats.playSeconds += Math.floor(this.playAcc);
        this.playAcc %= 1;
      }
    }

    if (this.playing && this.world) {
      const lock = this.lockTarget;
      let lockYaw: number | null = null;
      if (lock && lock.alive && !this.paused) {
        const d = Math.hypot(lock.pos.x - this.player.pos.x, lock.pos.z - this.player.pos.z);
        if (d > 1.5 + lock.radius) lockYaw = yawTo(this.player.pos.x, this.player.pos.z, lock.pos.x, lock.pos.z);
      }
      const hudDt = this.paused ? 0 : realDt;
      this.rig.update(hudDt, this.player.pos, lockYaw);
      const right = this.rig.right(this.tmpB);
      setListener(this.player.pos.x, this.player.pos.z, right.x, right.z);
      this.sun.position.set(this.player.pos.x + 12, 25, this.player.pos.z + 8);
      this.sun.target.position.copy(this.player.pos);
      this.hud.update(
        hudDt,
        this.hudState(),
        this.camera,
        lock && lock.alive ? this.tmpA.copy(lock.pos).setY(lock.aimHeight) : null,
      );
      this.hud.logVisible = debug.showLog;
      this.hud.menuOpen = this.menus.isOpen;
      this.atmosphere.update(hudDt);
      this.atmosphere.render();
    } else {
      this.renderer.setClearColor(0x0b1020);
      this.renderer.clear();
    }
    // The pause screen muffles the music (menus don't: PSO kept playing under them).
    const muffle = this.playing && !this.menus.isOpen && !this.input.locked;
    if (muffle !== this.muffled) setMuffled((this.muffled = muffle));
    this.input.endFrame();
  }

  // ============================================================== input

  private handleInput(): void {
    const inp = this.input;
    const p = this.player;

    this.moveDir.set(0, 0, 0);
    if (!p.alive) return;
    // While paralysed only an injector (a Sol one cures it) can be used.
    if (p.paralyzed) {
      if (inp.wasPressed('Digit1')) this.useInjector();
      const row = this.char.data.palette[this.paletteIndex];
      SLOT_KEYS.forEach((key, i) => {
        const q = i >= 2 ? row.quick[i - 2] : null;
        if (q?.kind === 'injector' && inp.wasPressed(key)) this.useInjector();
      });
      return;
    }

    const f = this.rig.forward(this.tmpA);
    const r = this.rig.right(this.tmpB);
    if (inp.isDown('KeyW')) this.moveDir.add(f);
    if (inp.isDown('KeyS')) this.moveDir.sub(f);
    if (inp.isDown('KeyD')) this.moveDir.add(r);
    if (inp.isDown('KeyA')) this.moveDir.sub(r);
    if (this.moveDir.lengthSq() > 0) this.moveDir.normalize();

    if (inp.wasPressed('KeyF')) this.toggleLock();
    if (inp.wasPressed('Tab')) this.cycleLock();
    if (inp.wasPressed('KeyC')) this.rig.snapBehind(p.yaw);
    if (inp.wasPressed('Digit1')) this.useInjector();
    // Space also interacts when something is in reach (even mid-move); otherwise it arms a dash.
    let spaceUsed = false;
    if (inp.wasPressed('KeyR')) {
      this.hud.pulseSlot(-1);
      this.interact();
    } else if (inp.wasPressed('Space') && this.interact()) {
      this.hud.pulseSlot(-1);
      spaceUsed = true;
    }
    this.handleDash(spaceUsed);

    const row = this.char.data.palette[this.paletteIndex];
    SLOT_KEYS.forEach((key, i) => {
      if (!inp.wasPressed(key)) return;
      this.hud.pulseSlot(i);
      if (i < 2) this.pressSource(row.mouse, i === 0 ? 'heavy' : 'light');
      else this.runQuick(row.quick[i - 2]);
    });
    if (inp.wheel) {
      const tech = this.char.cycleTech(inp.wheel);
      this.hud.float(this.tmpA.copy(p.pos).setY(2.5), techniques[tech].name, 'spell');
    }
  }

  /**
   * Space dashes toward the held direction. Space with no direction held does nothing until one is
   * pressed (while Space is still down); one dash per press. A press already spent on interacting
   * doesn't arm.
   */
  private handleDash(spaceUsed: boolean): void {
    const inp = this.input;
    const p = this.player;
    if (inp.wasPressed('Space') && !spaceUsed) this.dashArmed = true;
    if (!inp.isDown('Space')) this.dashArmed = false;
    if (!this.dashArmed || this.moveDir.lengthSq() === 0 || !p.canDash) return;
    this.dashArmed = false;
    if (p.dashCharges < 1) {
      this.hud.dashEmpty();
      return;
    }
    const lock = this.lockTarget;
    let orbit = null;
    if (lock?.alive) {
      // Locked on: W / S close in or back off, A / D circle the target.
      const fwd = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
      const side = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
      const n = Math.hypot(fwd, side) || 1;
      orbit = { x: lock.pos.x, z: lock.pos.z, fwd: fwd / n, side: side / n };
    }
    const from = p.pos.clone();
    const inside = this.char.hasMagPassive('slipstream') ? this.telegraphsAround() : [];
    if (!p.startDash(this.moveDir.x, this.moveDir.z, orbit)) return;
    this.slipFrom = inside.length ? inside : null;
    const st = this.char.data.stats;
    st.dashes = (st.dashes ?? 0) + 1;
    sfx('player.dash');
    this.world?.addEffect(new DashTrail(from, p.pos, dashCfg.duration));
    if (p.channelBroken) {
      this.hud.toast('Telepipe cancelled.', 'warn');
      p.channelBroken = null;
    }
  }

  /** Enemy telegraphs (not the player's own technique flashes) the player stands in. */
  private telegraphsAround(): Telegraph[] {
    const p = this.player;
    return (this.world?.telegraphs ?? []).filter((t) => !t.friendly && !t.done && inShape(t.shape, p.pos.x, p.pos.z, p.radius));
  }

  /** Slipstream (Mag): a dash that started inside enemy telegraphs and ended outside one makes the next attack or cast perfect. */
  private checkSlipstream(): void {
    const p = this.player;
    if (!this.slipFrom || p.dash) return;
    const escaped = this.slipFrom.some((t) => !inShape(t.shape, p.pos.x, p.pos.z, p.radius));
    this.slipFrom = null;
    if (!escaped || !p.alive) return;
    p.slipstream = magCfg.slipstreamTime;
    this.hud.float(this.tmpA.copy(p.pos).setY(2.6), 'SLIPSTREAM', 'proc');
  }

  /** A dash check appeared: until she has dashed a few times, say which key gets her out. */
  private dashHint(): void {
    if ((this.char.data.stats.dashes ?? 0) >= dashCfg.hintUntilDashes) return;
    const now = performance.now();
    if (now - this.lastDashHint < 12000) return;
    this.lastDashHint = now;
    this.hud.toast('Too wide to walk out of: <b>dash!</b> (Space + a direction)', 'warn');
  }

  private get paletteIndex(): number {
    return this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 1 : 0;
  }

  /** LMB / RMB: heavy or light from the row's source (weapon combo, or the selected attack tech). */
  private pressSource(source: PaletteRow['mouse'], type: AttackType): void {
    if (this.world?.def.kind === 'city') return;
    if (source === 'weapon') {
      this.handleCombo(this.player.pressAttack(type));
      return;
    }
    const tech = this.char.selectedTech();
    this.chainFeedback(this.combat.beginCast(tech, type), 'cast chain');
  }

  private runQuick(a: QuickAction): void {
    switch (a.kind) {
      case 'tech':
        if (this.world?.def.kind === 'city' && isAttackTech(a.tech)) return;
        this.chainFeedback(this.combat.beginCast(a.tech), 'cast chain');
        break;
      case 'item': {
        if (!this.player.canMove) return;
        const inst = this.char.data.inventory.find((i) => i.id === a.item);
        if (!inst) {
          this.hud.float(this.tmpA.copy(this.player.pos).setY(2.3), `No ${getDef(a.item).name}`, 'early');
          return;
        }
        const msg = this.useItem(inst.uid);
        if (msg) this.hud.float(this.tmpA.copy(this.player.pos).setY(2.3), msg, 'early');
        break;
      }
      case 'injector':
        this.useInjector();
        break;
      case 'empty':
        break;
    }
  }

  // ============================================================== update

  private update(dt: number): void {
    const p = this.player;
    const world = this.world!;
    const { events, castDone, channelDone } = p.update(dt, this.moveDir);
    this.checkSlipstream();
    if (formulas.tpRegen > 0 && p.alive) p.tp = Math.min(p.maxTp, p.tp + formulas.tpRegen * dt);
    this.handleCombo(events);
    if (castDone) this.combat.finishCast(castDone);
    if (channelDone?.what === 'telepipe') this.openTelepipe();
    if (p.channelBroken) {
      this.hud.toast(p.channelBroken === 'hit' ? 'The Telepipe was interrupted.' : 'Telepipe cancelled.', 'warn');
      p.channelBroken = null;
    }
    this.combat.tickPlayerStatus(dt);

    world.update(dt, p);
    this.tickInjectors(world, dt);
    this.cues.update(world);
    if (p.stepped) sfx(areas[world.areaId].audio.step);
    const inWindow = p.combo.inWindow || p.castChain.inWindow;
    if (inWindow && !this.wasInWindow) sfx('combo.window');
    this.wasInWindow = inWindow;
    const boss = world.boss;
    if (boss && boss.engaged && boss.alive && !this.bossMusic) {
      this.bossMusic = true;
      music.play(BOSSES[boss.id].music, { battle: false, fade: 0.3 });
    }
    if (this.victoryT >= 0) {
      this.victoryT -= dt;
      if (this.victoryT < 0) this.playAreaMusic();
    }

    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.invulnerable)) {
      this.lockTarget = this.lockTarget.alive ? null : this.pickLockTarget(true);
    }
    this.lastHitT += dt;

    this.refreshDropVerdicts();
    // Walk-over pickups: meseta, and charge orbs while the injector has room (they fade after a while).
    for (const pk of [...world.pickups]) {
      const orb = pk.content.kind === 'charge';
      if (orb && pk.expired) {
        world.removePickup(pk);
        continue;
      }
      if (!orb && pk.content.kind !== 'meseta') continue;
      const open = !orb || this.injectorRoom();
      if (orb) pk.setCharge(injectorDef(this.char.injector())?.kind ?? null, open);
      if (open && p.alive && Math.hypot(pk.pos.x - p.pos.x, pk.pos.z - p.pos.z) < 1.2) this.takePickup(pk);
    }

    // Death sequencing.
    if (this.deathT >= 0) {
      this.deathT += dt;
      if (this.deathT > 1.4) {
        this.deathT = -1;
        this.openDeathMenu();
      }
    }
  }

  // ========================================================== injectors

  /** No room fight and no boss engaged: the time between fights. */
  private get calm(): boolean {
    const w = this.world;
    return !!w && !w.roomActive && !(w.boss?.engaged && w.boss.alive);
  }

  private refillInjectors(): void {
    const inj = this.char.injector();
    if (inj) fillInjector(inj);
  }

  /** Give the equipped injector some doses (scaled by its charge rate). */
  private chargeInjectors(doses: number): void {
    const inj = this.char.injector();
    if (inj && doses > 0) addCharge(inj, doses, this.char);
  }

  /** The player's damage on a field enemy: its share of the enemy's HP bar, in doses. Bosses are tracked by HP below. */
  private chargeFromDamage(t: Hittable, dealt: number): void {
    if (!(t instanceof Enemy) || t.noReward || t.noCharge || t.maxHp <= 0) return;
    this.chargeInjectors((dealt / t.maxHp) * injectorCfg.chargePerEnemy * (t.elite ? injectorCfg.eliteChargeMult : 1));
  }

  private tickInjectors(world: World, dt: number): void {
    // Out of combat the injector refills slowly (both kinds at the same rate); Pioneer 2 refills it at once.
    if (this.calm && this.player.alive && world.def.kind !== 'city') {
      this.calmT += dt;
      const inj = this.char.injector();
      if (inj && this.calmT >= injectorCfg.calmDelay) addCharge(inj, injectorCfg.calmRate * dt, this.char, true);
    } else this.calmT = 0;
    // Boss HP lost since last frame (any source the player caused: hits, techs, burns).
    const boss = world.boss;
    if (boss) {
      if (this.bossHpSeen >= 0 && boss.hp < this.bossHpSeen && boss.maxHp > 0) {
        this.chargeInjectors(((this.bossHpSeen - Math.max(0, boss.hp)) / boss.maxHp) * boss.injectorCharge);
      }
      this.bossHpSeen = boss.hp;
    }
  }

  /** Key 1 (or a quick slot): take a dose from the equipped injector. */
  private useInjector(): void {
    const p = this.player;
    const at = () => this.tmpA.copy(p.pos).setY(2.3);
    const inst = this.char.injector();
    if (!inst) {
      this.hud.float(at(), 'No injector equipped', 'early');
      return;
    }
    const s = injectorStats(inst, this.char);
    const sol = s.mod === 'sol';
    const status = p.poison > 0 || p.paralyzed || p.burnStacks > 0 || p.corruption > 0;
    if (!p.alive || (p.paralyzed ? !sol : !p.canUseItem)) return;
    const hp = s.kind === 'mate';
    const [cur, max] = hp ? [p.hp, p.maxHp] : [p.tp, p.maxTp];
    if (cur >= max && !(sol && status)) {
      this.hud.float(at(), `${hp ? 'HP' : 'TP'} is already full`, 'early');
      return;
    }
    if (!spendDose(inst, this.char)) {
      this.hud.float(at(), 'Injector empty', 'early');
      sfx('ui.error');
      return;
    }
    const amount = doseAmount(s, max, cur);
    if (s.over > 0) p.addRegen(hp ? 'hp' : 'tp', amount, s.over);
    else if (hp) p.hp = Math.min(p.maxHp, p.hp + amount);
    else p.tp = Math.min(p.maxTp, p.tp + amount);
    this.hud.float(this.tmpA.copy(p.pos).setY(2.2), `+${amount}${hp ? '' : ' TP'}${s.over ? '…' : ''}`, hp ? 'heal' : 'tp');
    if (sol) {
      p.poison = 0;
      p.burnStacks = 0;
      p.cureParalysis(injectorCfg.solWard);
      this.cleanse();
    }
    if (s.mod === 'bracing') p.brace = injectorCfg.braceTime;
    if (!hp && this.char.hasMagPassive('clarity')) {
      p.clarity = magCfg.clarityTime;
      this.hud.float(this.tmpA.copy(p.pos).setY(2.7), 'CLARITY', 'proc');
    }
    sfx('item.drink');
    p.onItemUse(injectorCfg.useLock);
  }

  /** Clear Corruption (a cleared room, a Sol dose, a boss kill). Max HP comes back; HP doesn't. */
  private cleanse(): void {
    const p = this.player;
    if (p.corruption <= 0) return;
    p.corruption = 0;
    p.corruptDecay = 0;
    this.hud.float(this.tmpA.copy(p.pos).setY(2.4), 'CLEANSED', 'heal');
    sfx('status.cleanse');
  }

  /** Last Stand (Mag DEF keystone): a free dose from a Mate injector, on top of the 1 HP. */
  private lastStandDose(): void {
    const inst = this.char.injector();
    if (!inst || injectorDef(inst)?.kind !== 'mate') return;
    const p = this.player;
    const amount = doseAmount(injectorStats(inst, this.char), p.maxHp, 1);
    p.addRegen('hp', amount, 0.3);
    this.hud.float(this.tmpA.copy(p.pos).setY(2.2), `+${amount}`, 'heal');
  }

  // =========================================================== telepipe

  /** Show this area's end of the Telepipe, if it has one. */
  private placePortal(): void {
    const tp = this.telepipe;
    const world = this.world;
    if (!tp || !world) return;
    if (world.def.kind === 'city') {
      const at = world.featurePoint('cityTeleporter') ?? world.startPoint();
      this.portal = new Interactable('portal', `Telepipe to ${areas[tp.area].name}`, at.x + 3.5, at.z);
    } else if (tp.area === world.areaId) {
      this.portal = new Interactable('portal', 'Telepipe to Pioneer 2', tp.x, tp.z);
    } else return;
    world.addInteractable(this.portal);
  }

  /** The Telepipe cast finished: open a portal here (closing any older one). */
  private openTelepipe(): void {
    const world = this.world;
    if (!world || !this.inField || !this.char.consume('telepipe')) return;
    if (this.portal) world.removeInteractable(this.portal);
    const p = this.player;
    this.telepipe = { area: world.areaId, x: p.pos.x + Math.sin(p.yaw) * 1.8, z: p.pos.z + Math.cos(p.yaw) * 1.8 };
    this.placePortal();
    if (this.portal) this.telepipe = { area: world.areaId, x: this.portal.pos.x, z: this.portal.pos.z };
    sfx('world.teleport');
    this.hud.toast('Telepipe open. It leads to Pioneer 2, and back here once.', 'good');
  }

  /** Perfect / broken feedback shared by weapon combos and cast chains. */
  private chainFeedback(events: ComboEvent[], what: string): void {
    const p = this.player;
    for (const ev of events) {
      // Slipstream (Mag): the first swing or cast after dashing out of a telegraph lands perfect.
      const slip = ev.kind === 'start' && p.slipstream > 0;
      if (slip) {
        p.slipstream = 0;
        if (what === 'combo') this.slipHit = true;
        else if (p.cast) p.cast.streak = Math.min(p.cast.streak + 1, comboDamage.length - 1);
      }
      if (ev.kind === 'start' && (ev.perfect || slip)) {
        sfx('combo.perfect');
        p.onPerfect();
        this.hud.float(this.tmpA.copy(p.pos).setY(2.3), 'perfect', 'perfect');
      } else if (ev.kind === 'early') {
        sfx('combo.early');
        p.onEarly();
        this.hud.float(this.tmpA.copy(p.pos).setY(2.3), 'too early', 'early');
        this.hud.pushLog(`<span class="l-bad">${what} broken: pressed too early</span>`);
      }
    }
  }

  private handleCombo(events: ComboEvent[]): void {
    const p = this.player;
    this.chainFeedback(events, 'combo');
    for (const ev of events) {
      switch (ev.kind) {
        case 'start': {
          p.onSwingStart();
          const target = this.combat.aimTarget();
          if (target) p.aimYaw = yawTo(p.pos.x, p.pos.z, target.pos.x, target.pos.z);
          else if (this.moveDir.lengthSq() > 0) p.aimYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
          else p.aimYaw = null;
          break;
        }
        case 'hit': {
          this.attackSound(ev.type as AttackType, ev.hitIndex);
          const streak = this.slipHit ? Math.min(ev.streak + 1, comboDamage.length - 1) : ev.streak;
          this.slipHit = false;
          this.combat.playerAttack(ev.type as AttackType, ev.hitIndex, streak);
          break;
        }
        case 'early':
        case 'end':
          break;
      }
    }
  }

  /** Whoosh / shot for the weapon in hand; heavies and finishers sound bigger. */
  private attackSound(type: AttackType, hitIndex: number): void {
    const kind = this.char.weaponInstance() ? this.char.weaponKind().kind : null;
    const strong = type === 'heavy' || hitIndex === 2;
    const id: SfxId = kind ? ATTACK_SFX[kind] : 'swing.blunt';
    sfx(id, { pitch: strong ? 0.85 : 1, vol: strong ? 1.2 : 1 });
  }

  // ======================================================= interactions

  private nearestInteractable(): Interactable | null {
    if (!this.world) return null;
    const p = this.player.pos;
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.world.interactables) {
      if (!it.enabled) continue;
      const d = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
      if (d < it.range && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }

  /** Unbroken supply box within reach, if any. */
  private nearestBox(): Breakable | null {
    if (!this.world) return null;
    const p = this.player.pos;
    let best: Breakable | null = null;
    let bestD = playerCfg.boxRange;
    for (const b of this.world.boxes) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z) - b.radius;
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Supply boxes only open with the interact key; attacks pass them by. */
  private breakBox(b: Breakable): void {
    if (!b.smash()) return;
    sfx('box.break', { x: b.pos.x, z: b.pos.z });
    this.world!.breakBox(b);
    this.spawnDrop(rollBoxDrop(this.rng, this.char.lootBias()), b.pos.x, b.pos.z);
    if (this.rng() < injectorCfg.orbBoxChance) this.spawnDrop({ kind: 'charge' }, b.pos.x, b.pos.z);
  }

  /** Does the equipped injector have room for a charge orb? */
  private injectorRoom(): boolean {
    const inj = this.char.injector();
    return !!inj && chargeOf(inj, this.char) < injectorStats(inj, this.char).doses;
  }

  /** Junk / upgrade looks of the drops: re-read after a level-up, attribute or Mag point, equip or grind. */
  private refreshDropVerdicts(): void {
    const d = this.char.data;
    // Injectors stay out of the key: their charge changes every hit, and their verdict only needs the stats.
    const worn = (['weapon', 'frame', 'barrier'] as const).map((s) => JSON.stringify(this.char.equippedItem(s) ?? null));
    const key = `${d.level}|${JSON.stringify(d.attributes)}|${d.mag.cells.join(',')}|${worn.join('|')}`;
    if (key === this.dropKey) return;
    this.dropKey = key;
    for (const pk of this.world?.pickups ?? []) this.judgeDrop(pk);
  }

  private judgeDrop(pk: Pickup): void {
    if (pk.content.kind === 'item') pk.setVerdict(dropVerdict(this.char, pk.content.item));
  }

  private nearestPickup(): Pickup | null {
    if (!this.world) return null;
    const p = this.player.pos;
    let best: Pickup | null = null;
    let bestD = playerCfg.pickupRange;
    for (const pk of this.world.pickups) {
      if (pk.content.kind === 'charge') continue; // walk-over only
      const d = Math.hypot(pk.pos.x - p.x, pk.pos.z - p.z);
      if (d < bestD) {
        best = pk;
        bestD = d;
      }
    }
    return best;
  }

  /** Use whatever is in reach. Returns whether there was anything to use. */
  private interact(): boolean {
    if (!this.player.canMove) return false;
    const pk = this.nearestPickup();
    if (pk) {
      this.takePickup(pk);
      return true;
    }
    const it = this.nearestInteractable();
    if (it) {
      this.useInteractable(it);
      return true;
    }
    const box = this.nearestBox();
    if (!box) return false;
    this.breakBox(box);
    return true;
  }

  private takePickup(pk: Pickup): void {
    const world = this.world!;
    if (pk.content.kind === 'meseta') {
      sfx('pickup.meseta');
      this.char.data.meseta += pk.content.amount;
      this.hud.float(this.tmpA.copy(pk.pos).setY(1.4), `+${pk.content.amount} M`, 'meseta');
      world.removePickup(pk);
      return;
    }
    if (pk.content.kind === 'charge') {
      const inj = this.char.injector();
      if (!inj) return;
      addCharge(inj, injectorCfg.orbDoses, this.char, true);
      sfx('pickup.item', { pitch: 1.35 });
      const dose = injectorCfg.orbDoses === 1 ? '1 dose' : `${injectorCfg.orbDoses} doses`;
      this.hud.float(this.tmpA.copy(pk.pos).setY(1.4), `+${dose}`, injectorDef(inj)?.kind === 'mate' ? 'heal' : 'tp');
      world.removePickup(pk);
      return;
    }
    const item = pk.content.item;
    if (!this.char.addItem(item)) {
      this.hud.toast('Inventory full!', 'warn');
      sfx('ui.error');
      return;
    }
    sfx('pickup.item');
    const def = getDef(item.id);
    this.hud.toast(`Picked up <b>${itemName(item)}</b>`, def.rare ? 'rare' : '');
    if (def.rare) this.autosave();
    world.removePickup(pk);
  }

  /** The stylist: edit the appearance with the creation steps; free, any time. */
  private openStylist(): void {
    const w = this.char.weaponInstance();
    this.openMenu(
      new StylistMenu({
        look: playerLook(this.char.data),
        weapon: w ? (getDef(w.id) as { kind: WeaponKind }).kind : null,
        apply: (look) => {
          this.char.data.appearance = look;
          this.player.rebuildModel();
          this.closeMenu();
          this.autosave();
          this.hud.toast('New look saved.', 'good');
        },
        cancel: () => this.closeMenu(),
      }),
    );
  }

  private choice(title: string, text: string, options: ChoiceOption[], closable = true): void {
    this.openMenu(new ChoiceMenu(title, text, options, closable));
  }

  private useInteractable(it: Interactable): void {
    const cancel: ChoiceOption = { label: 'Cancel', run: () => this.closeMenu() };
    switch (it.kind) {
      case 'shopWeapon':
        this.openMenu(new ShopMenu(this, 'weapon', this.stock.weapon));
        break;
      case 'shopArmor':
        this.openMenu(new ShopMenu(this, 'armor', this.stock.armor));
        break;
      case 'shopItem':
        this.openMenu(new ShopMenu(this, 'item', this.stock.item));
        break;
      case 'stylist':
        this.openStylist();
        break;
      case 'medical':
        this.choice('Medical Center', 'We can restore your HP and TP, free of charge.', [
          {
            label: 'Treatment',
            run: () => {
              this.player.fullRestore();
              sfx('tech.resta');
              this.closeMenu();
              this.hud.toast('HP and TP fully restored.', 'good');
            },
          },
          cancel,
        ]);
        break;
      case 'cityTeleporter':
        this.teleporterMenu();
        break;
      case 'toCity':
        this.choice('Teleporter', 'Return to Pioneer 2?', [
          { label: 'Return to Pioneer 2', run: () => this.travel(() => this.enterArea('city', 'start')) },
          cancel,
        ]);
        break;
      case 'switch':
        if (it.active || !it.lock) return;
        it.active = true;
        sfx('world.switch');
        this.world!.markUnlocked(it.lock);
        this.rig.shake(0.15);
        this.hud.toast('A gate has been unlocked somewhere.', 'good');
        break;
      case 'pylon': {
        const pylon = this.world?.pylonOf(it);
        if (!pylon) return;
        // The Seal of Light and the Falz Halo (pylonKeeper) keep pylons you light burning longer.
        const seal = this.char.hasGearPassive('pylonKeeper');
        if (!pylon.light(pylonCfg.litTime * (seal ? pylonCfg.sealLitMult : 1))) return;
        sfx('ruins.pylon', { x: pylon.pos.x, z: pylon.pos.z });
        this.world?.addEffect(new Ring(pylon.pos.x, pylon.pos.z, 0xffe8a0, pylonCfg.radius, 0.5));
        const st = this.char.data.stats;
        if (!st.pylonsLit) this.hud.toast('The pylon blazes: its light cleanses Corruption and weakens the Dark.', 'good');
        st.pylonsLit = (st.pylonsLit ?? 0) + 1;
        break;
      }
      case 'power': {
        if (!it.lock) return;
        this.world!.togglePower(it.lock);
        sfx('world.switch', { pitch: 0.9 });
        this.rig.shake(0.08);
        this.hud.toast(it.label, 'good');
        // Warden Core (switchBrace): working the machinery braces you.
        if (this.char.hasGearPassive('switchBrace')) {
          this.player.brace = injectorCfg.braceTime;
          this.hud.float(this.tmpA.copy(this.player.pos).setY(2.6), 'BRACED', 'proc');
        }
        break;
      }
      case 'toBoss': {
        const dest = it.to ?? 'dragon';
        this.choice('Teleporter', `A powerful presence awaits beyond. Proceed to the ${areas[dest].name}?`, [
          { label: 'Proceed', run: () => this.travel(() => this.goDeeper(dest)) },
          cancel,
        ]);
        break;
      }
      case 'toNext': {
        const dest = it.to ?? 'cave2';
        this.choice('Teleporter', `Go deeper, to ${areas[dest].name}?`, [
          { label: 'Proceed', run: () => this.travel(() => this.goDeeper(dest)) },
          cancel,
        ]);
        break;
      }
      case 'portal': {
        const tp = this.telepipe;
        if (!tp) return;
        if (this.world?.def.kind === 'city') {
          this.choice('Telepipe', `Return to ${areas[tp.area].name}? The Telepipe closes behind you.`, [
            {
              label: 'Go back',
              run: () =>
                this.travel(() => {
                  this.telepipe = null;
                  this.enterArea(tp.area, { x: tp.x, z: tp.z });
                }),
            },
            cancel,
          ]);
        } else {
          this.choice('Telepipe', 'Return to Pioneer 2? The portal stays open until you come back through it.', [
            { label: 'Return to Pioneer 2', run: () => this.travel(() => this.enterArea('city', 'start')) },
            cancel,
          ]);
        }
        break;
      }
      case 'start':
        break;
    }
  }

  /** The city teleporter's expedition list for the session's difficulty. */
  private teleporterMenu(): void {
    const hard = this.hard;
    const cancel: ChoiceOption = { label: 'Cancel', run: () => this.closeMenu() };
    const opts: ChoiceOption[] = [];
    const tag = hard ? ' (Nightmare)' : '';
    for (const exp of Object.values(expeditions)) {
      // Normal: the previous expedition's boss. Nightmare: Dark Falz on Normal for the Forest, then the previous Nightmare boss.
      let locked: boolean;
      let why = exp.needs ? `Defeat ${BOSSES[exp.needs].title}${hard ? ' on Nightmare' : ''} to unlock` : '';
      if (exp.needs) locked = this.char.bossKills(exp.needs, hard) <= 0;
      else if (!hard) locked = false;
      else {
        locked = !nightmareOpen(this.char.data);
        why = `Defeat ${BOSS_IDS.map((b) => BOSSES[b]).find((b) => b.opensNightmare)!.title} to unlock`;
      }
      if (locked) {
        opts.push({ label: exp.name + tag, disabled: true, sub: why, run: () => {} });
        continue;
      }
      // One row per expedition: it resumes at the furthest floor reached (its start; cleared rooms stay cleared).
      const r = this.runs[exp.id];
      const live = !!r && !r.bossDefeated;
      const n = exp.floors.length;
      const at = areas[exp.floors[live ? r.floor : 0]];
      const atBoss = live && r.floor === n - 1;
      opts.push({
        label: exp.name + tag,
        tag: live ? `${r.floor + 1}/${n} · ${atBoss ? 'Boss' : at.name}` : undefined,
        sub: live ? `Continue at ${at.name}` : r?.bossDefeated ? `Cleared: starts again at ${at.name}` : `Start at ${at.name}`,
        run: () => this.travel(() => this.resumeExpedition(exp.id)),
      });
    }
    opts.push(cancel);
    this.choice('Teleporter', hard ? 'Nightmare: where do you want to go?' : 'Where do you want to go?', opts);
  }

  private travel(go: () => void): void {
    sfx('world.teleport');
    this.menus.close();
    go();
    this.input.requestLock();
    this.updateOverlay();
  }

  // ============================================================ killing

  private onKill(t: Hittable): void {
    const world = this.world!;
    if (t instanceof Enemy) {
      // Re-formed Pan Arms halves give nothing, so splitting can't be farmed.
      if (t.noReward) return;
      this.char.data.stats.kills++;
      this.gainXp(t.xp);
      const cls = this.char.lootBias();
      this.spawnDrop(rollEnemyDrop(t.arch, this.rng, cls), t.pos.x, t.pos.z);
      if (t.champion) for (const d of rollChampionBonus(t.arch, this.rng, cls)) this.spawnDrop(d, t.pos.x, t.pos.z);
      else if (t.elite) this.spawnDrop(rollEliteBonus(t.arch, this.rng, cls), t.pos.x, t.pos.z);
      // Charge orb: elites and champions always, others sometimes (never from bots that reboot, so no farming).
      if (!t.noCharge && (t.elite || t.champion || this.rng() < injectorCfg.orbChance)) this.spawnDrop({ kind: 'charge' }, t.pos.x, t.pos.z);
      return;
    }
    const boss = world.boss;
    if (boss && boss.owns(t)) {
      // Boss parts share its HP: only the whole boss going down counts.
      if (boss.alive) return;
      const def = BOSSES[boss.id];
      const hard = this.run.hard;
      this.char.data.stats.kills++;
      const first = this.char.addBossKill(def.id, hard) === 1;
      this.cleanse();
      this.run.bossDefeated = true;
      this.lockTarget = null;
      music.stop(0.4);
      sfx('jingle.victory');
      this.victoryT = 8;
      this.hud.banner(`${boss.name.toUpperCase()} DEFEATED`, 'boss');
      this.autosave();
      this.hud.toast('Quest complete! A teleporter to Pioneer 2 has appeared.', 'good');
      if (first) this.announceUnlocks(def, hard);
      this.gainXp(hard ? hardCfg.bosses[def.id].xp : def.xp());
      // Loot lands on the deck / arena floor around the centre, or where it fell.
      const at = def.dropsAt === 'center' ? world.level.center() : t.pos;
      const drops = rollBossDrops(def.id, hard, this.rng, this.char.lootBias());
      drops.forEach((d, i) => {
        const a = (i / drops.length) * Math.PI * 2;
        this.spawnDrop(d, at.x + Math.sin(a) * def.dropRing, at.z + Math.cos(a) * def.dropRing * (def.dropStretch ?? 1));
      });
      world.spawnReturnTeleporter();
    }
  }

  /** Toasts for what a boss's first kill opened: shop tiers, the next expedition, Nightmare. */
  private announceUnlocks(def: BossDef, hard: boolean): void {
    const shop = (hard ? def.hardShop : def.shop)[0];
    if (shop) this.hud.toast(`Pioneer 2 shops will now stock tier ${shop.tier} gear (from Lv ${shop.level}).`, 'rare');
    const next = expeditionOpenedBy(def.id);
    if (next) this.hud.toast(`A new ${hard ? 'Nightmare ' : ''}expedition is open: the ${next.name}.`, 'rare');
    if (!hard && def.opensNightmare && !this.char.data.stats.nightmareKept) {
      this.hud.toast('Nightmare is open: Save &amp; quit (menu, I) and pick it when you start again.', 'rare');
    }
  }

  private spawnDrop(d: Drop | null, x: number, z: number): void {
    if (!d || !this.world) return;
    const ox = (this.rng() - 0.5) * 1.2;
    const oz = (this.rng() - 0.5) * 1.2;
    this.judgeDrop(this.world.addPickup(d, x + ox, z + oz));
    if (d.kind === 'item' && getDef(d.item.id).rare) sfx('loot.rare', { x, z });
  }

  private gainXp(xp: number): void {
    const before = this.char.baseStats();
    const levels = this.char.addXp(xp);
    this.hud.pushLog(`<span class="l-kill">+${xp} EXP</span>`);
    if (levels > 0) {
      const after = this.char.baseStats();
      this.player.hp += after.hp - before.hp;
      this.player.tp += after.tp - before.tp;
      this.hud.banner(`LEVEL UP!  Lv.${this.char.level}`, 'good');
      sfx('jingle.levelup');
      this.autosave();
      this.hud.toast(
        `HP +${after.hp - before.hp} · TP +${after.tp - before.tp} · ATP +${after.atp - before.atp} · DFP +${after.dfp - before.dfp} · MST +${after.mst - before.mst} · ATA +${after.ata - before.ata} · EVP +${after.evp - before.evp}`,
      );
      const ap = this.char.attributePoints;
      if (ap > 0) this.hud.toast(`${ap} attribute point${ap > 1 ? 's' : ''} to spend (Menu → Status).`, 'good');
      const pts = this.char.magPoints;
      if (pts > 0) {
        this.hud.toast(`Your Mag can learn: ${pts} point${pts > 1 ? 's' : ''} to spend (Menu → Mag).`, 'good');
        sfx('mag.hungry');
      }
    }
  }

  private giveItem(inst: ItemInstance): void {
    if (this.char.addItem(inst)) this.hud.toast(`Received <b>${itemName(inst)}</b>`);
    else this.hud.toast('Inventory full!', 'warn');
  }

  private debugKillAll(): void {
    if (!this.world) return;
    for (const h of this.world.hittables()) {
      if (h.invulnerable) continue;
      if (h.damage(h.hp, h.pos.x, h.pos.z, 0, 0)) this.onKill(h);
    }
  }

  // ============================================================== death

  private onPlayerHurt(): void {
    if (this.player.alive || this.deathT >= 0) return;
    this.char.data.stats.deaths++;
    this.lockTarget = null;
    sfx('player.death');
    music.stop(1.2);
    this.hud.pushLog('<span class="l-bad">You have fallen.</span>');
    this.deathT = 0;
  }

  private openDeathMenu(): void {
    sfx('jingle.death');
    const floor = areas[expeditions[this.run.expedition].floors[this.run.floor]];
    const back = this.telepipe
      ? 'Your Telepipe is still open: step through it to come back'
      : `The city teleporter brings you back to ${floor.name}`;
    this.choice(
      'You have fallen',
      '',
      [
        {
          label: 'Return to Pioneer 2',
          sub: back,
          run: () =>
            this.travel(() => {
              this.player.resetState();
              this.player.fullRestore();
              this.enterArea('city', 'start');
            }),
        },
      ],
      false,
    );
  }

  // ============================================================ lock-on

  private toggleLock(): void {
    this.lockTarget = this.lockTarget ? null : this.pickLockTarget(false);
  }

  /** Tab: lock what you're looking at; when already locked, step to the next target to the right. */
  private cycleLock(): void {
    const cur = this.lockTarget?.alive ? this.lockTarget : null;
    if (!cur) {
      this.lockTarget = this.pickLockTarget(false);
      return;
    }
    // Sweep clockwise around the player from the current target. The order is camera-independent,
    // so the camera swinging to the new target can't make Tab bounce between two enemies.
    const p = this.player.pos;
    const from = yawTo(p.x, p.z, cur.pos.x, cur.pos.z);
    let next: Hittable | null = null;
    let bestSweep = Infinity;
    for (const e of this.lockCandidates()) {
      if (e === cur) continue;
      let sweep = -angleDelta(from, yawTo(p.x, p.z, e.pos.x, e.pos.z)); // + = to the right
      if (sweep <= 1e-4) sweep += Math.PI * 2;
      if (sweep < bestSweep) {
        bestSweep = sweep;
        next = e;
      }
    }
    if (next) this.lockTarget = next;
  }

  /** Targets in lock range with a clear line from the player (no locking through walls). */
  private lockCandidates(): Hittable[] {
    if (!this.world) return [];
    const level = this.world.level;
    const p = this.player.pos;
    const eye = this.tmpC.set(p.x, p.y + 1.2, p.z);
    const dir = this.tmpD;
    return this.world.targets().filter((e) => {
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > lockOn.range + e.radius) return false;
      dir.set(e.pos.x, e.aimHeight, e.pos.z).sub(eye);
      const d = dir.length();
      if (d < 0.01) return true;
      return level.raycast(eye, dir.divideScalar(d), d) >= d - e.radius;
    });
  }

  /**
   * The target you're looking at: on screen and closest to the middle of the view (measured from
   * the camera, so it matches what's drawn), nearer ones winning near-ties. With nothing on screen,
   * an explicit lock press falls back to the nearest target; auto-retargets don't.
   */
  private pickLockTarget(onScreenOnly: boolean): Hittable | null {
    const p = this.player.pos;
    const cam = this.camera;
    cam.updateMatrixWorld();
    let best: Hittable | null = null;
    let bestScore = Infinity;
    let nearest: Hittable | null = null;
    let nearestD = Infinity;
    for (const e of this.lockCandidates()) {
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = e;
      }
      const v = this.tmpC.set(e.pos.x, e.aimHeight, e.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const ang = Math.abs(angleDelta(this.rig.yaw, yawTo(cam.position.x, cam.position.z, e.pos.x, e.pos.z)));
      const score = ang + (0.25 * d) / lockOn.range;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ?? (onScreenOnly ? null : nearest);
  }

  // ============================================================ GameApi

  /** Use a consumable from a quick slot (menus have no Use button: nothing is used with the game paused). */
  useItem(uid: string): string | null {
    const inst = this.char.find(uid);
    if (!inst) return 'No such item';
    const def = getDef(inst.id);
    if (def.type !== 'consumable') return 'Cannot use that';
    if (def.fieldOnly && !this.inField) return `${def.name} only works outside the city`;
    const p = this.player;
    switch (def.effect) {
      case 'telepipe':
        if (this.menus.isOpen) {
          // From the inventory: back to the game, already casting (a step, a dash or a hit still breaks it).
          if (!p.canMove) return "You can't use it right now";
          this.closeMenu();
        } else if (this.moveDir.lengthSq() > 0) return 'Stand still to use a Telepipe';
        p.startChannel('telepipe', telepipeCfg.castTime);
        sfx('tech.charge', { pitch: 0.7 });
        return null; // consumed when the cast completes
    }
    this.char.removeItem(uid, 1);
    sfx('item.drink');
    return null;
  }

  /** Short feedback toast (shown above menus, at the bottom while one is open). */
  notify(text: string, kind: '' | 'good' | 'warn' = ''): void {
    this.hud.toast(esc(text), kind);
    if (kind === 'warn') sfx('ui.error');
  }

  magLearn(ids: string[]): string | null {
    const ch = this.char;
    const formBefore = magForm(ch.mag, ch.leadAttribute).name;
    const err = learnCells(ch.mag, ch.level, ch.data.attributes, ids);
    if (err) return err;
    this.player.refreshMag();
    this.autosave();
    const form = magForm(ch.mag, ch.leadAttribute).name;
    sfx(form !== formBefore ? 'jingle.magEvolve' : 'mag.feed');
    // A learned square shows on the grid (and plays a sound); only an evolution gets a banner.
    if (form !== formBefore) {
      this.hud.banner(`MAG EVOLVED: ${form.toUpperCase()}`, 'good');
      this.notify(`Your Mag evolved into ${form}!`, 'good');
    }
    return null;
  }

  /** Spend one attribute point (permanent): max HP and TP grow at once, and the title, outfit and Mag may follow. */
  attrSpend(attr: AttributeId): string | null {
    const ch = this.char;
    const p = this.player;
    const before = ch.baseStats();
    const err = ch.spendAttribute(attr);
    if (err) return err;
    const after = ch.baseStats();
    p.hp += after.hp - before.hp;
    p.tp += after.tp - before.tp;
    p.refreshMag();
    p.refreshLook();
    this.autosave();
    sfx('ui.confirm');
    return null;
  }

  equipItem(uid: string): string | null {
    const r = this.char.equip(uid);
    this.player.refreshLook();
    this.player.refreshWeapon();
    this.player.combo.interrupt();
    if (r.ok) sfx('ui.equip');
    return r.ok ? null : (r.reason ?? 'Cannot equip');
  }

  unequipItem(uid: string): void {
    this.char.unequip(uid);
    this.player.refreshLook();
    this.player.refreshWeapon();
    sfx('ui.equip', { pitch: 0.8 });
  }

  discardItem(uid: string): void {
    const inst = this.char.removeItem(uid, Infinity);
    if (inst && this.inField) {
      const p = this.player.pos;
      this.judgeDrop(this.world!.addPickup({ kind: 'item', item: inst }, p.x + Math.sin(this.player.yaw) * 1.2, p.z + Math.cos(this.player.yaw) * 1.2));
    }
  }

  grindItem(weaponUid: string, grinderUid: string, track: GrindTrack): string | null {
    const r = this.char.grind(weaponUid, grinderUid, track);
    if (!r.ok) return r.reason ?? 'Failed';
    sfx('ui.equip', { pitch: 1.2 });
    const where = track === 'edge' ? 'Edge' : ATTR_LABEL[track];
    this.notify(`Grind successful! ${itemName(this.char.find(weaponUid)!)} · ${where} +${r.levels}${r.wasted ? ` (${r.wasted} lost)` : ''}`, 'good');
    return null;
  }

  setPalette(row: number, col: number, edit: PaletteEdit): void {
    const r = this.char.data.palette[row];
    if (edit.kind === 'source') r.mouse = edit.source;
    else if (col > 0) r.quick[col - 1] = edit;
  }

  buy(proto: ItemInstance): string | null {
    const price = buyPrice(proto);
    if (this.char.data.meseta < price) return 'Not enough Meseta';
    const inst = makeItem(proto.id, { attrs: proto.attrs, grind: proto.grind, bane: proto.bane, special: proto.special });
    if (!this.char.addItem(inst)) return 'Inventory full (or stack limit reached)';
    this.char.data.meseta -= price;
    sfx('ui.buy');
    this.autosave();
    return null;
  }

  damageFoe(): Foe {
    return expeditionFoe(this.run.expedition, this.hard);
  }

  sell(uid: string): string | null {
    const inst = this.char.find(uid);
    if (!inst) return 'No such item';
    if (this.char.isEquipped(uid)) return 'Unequip it first';
    const price = sellPrice(inst);
    this.char.removeItem(uid, Infinity);
    this.char.data.meseta += price;
    sfx('ui.sell');
    this.autosave();
    this.notify(`Sold ${itemName(inst)} for ${price} M.`);
    return null;
  }

  // ================================================================ HUD

  /** The target's affixes for the enemy frame: one chip each, in its aura colour. */
  private affixChips(e: Enemy): { name: string; color: string }[] {
    return e.affixes.map((a) => ({ name: AFFIXES[a].name, color: `#${AFFIXES[a].color.toString(16).padStart(6, '0')}` }));
  }

  private hudState(): HudState {
    const p = this.player;
    const ch = this.char;
    const idx = this.paletteIndex;
    const row = ch.data.palette[idx];
    const selTech = ch.selectedTech();
    const source = (type: AttackType, key: string): PaletteSlotView => {
      if (row.mouse === 'weapon') {
        const kind = ch.weaponInstance() ? ch.weaponKind().kind : 'none';
        const sp = type === 'heavy' ? ch.weaponSpecial() : undefined;
        const label = type === 'light' ? 'Light attack (area)' : `Heavy attack (single target)${sp ? ` · ${specials[sp].name}` : ''}`;
        return { key, label, icon: weaponIcon(kind, type), kind: type };
      }
      const cost = this.combat.techCost(selTech, type);
      const label = `${type === 'light' ? 'Light' : 'Heavy'} ${techniques[selTech].name} — ${cost} TP (wheel: change)`;
      return { key, label, icon: techIcon(selTech, type), count: String(cost), kind: type, disabled: p.tp < cost };
    };
    const quick = (a: QuickAction, key: string): PaletteSlotView => {
      switch (a.kind) {
        case 'tech': {
          const cost = this.combat.techCost(a.tech);
          const label = `${techniques[a.tech].name} — ${cost} TP`;
          const restores = techniques[a.tech].kind === 'heal' ? 'hp' : undefined;
          return { key, label, icon: techIcon(a.tech), count: String(cost), kind: 'tech', disabled: p.tp < cost, restores };
        }
        case 'item': {
          const n = ch.countOf(a.item);
          const def = getDef(a.item);
          return { key, label: def.name, icon: itemIcon(a.item), count: String(n), kind: 'item', disabled: n === 0 };
        }
        case 'injector': {
          const inst = ch.injector();
          if (!inst) return { key, label: 'Injector: none equipped', icon: '', kind: 'item', disabled: true };
          const doses = Math.floor(chargeOf(inst, ch));
          const kind = injectorDef(inst)!.kind;
          return { key, label: `${itemName(inst)} (key 1)`, icon: itemIcon(inst.id), count: String(doses), kind: 'item', disabled: doses < 1, restores: kind === 'mate' ? 'hp' : 'tp' };
        }
        case 'empty':
          return { key, label: 'Empty', icon: '', kind: 'empty' };
      }
    };
    const palette: PaletteSlotView[] = [
      source('heavy', SLOT_KEY_LABELS[0]),
      source('light', SLOT_KEY_LABELS[1]),
      quick(row.quick[0], SLOT_KEY_LABELS[2]),
      quick(row.quick[1], SLOT_KEY_LABELS[3]),
    ];

    const world = this.world!;
    const boss = world.boss;
    const shown = this.lockTarget?.alive
      ? this.lockTarget
      : this.lastHit?.alive && this.lastHitT < 4
        ? this.lastHit
        : null;

    let prompt: string | null = null;
    let context: ContextView | null = null;
    if (p.alive && !this.menus.isOpen) {
      const pk = this.nearestPickup();
      const it = this.nearestInteractable();
      if (pk) {
        const v = pk.verdict;
        // Same marks as the inventory; a requirement you don't meet yet is amber, not red.
        const mark = v?.mark === 'no' && v.look !== 'junk' ? 'locked' : v?.mark;
        const note = v?.note ? `<div class="pk-note ${mark}">${DROP_MARK[v.mark]} ${v.note}</div>` : '';
        prompt = `<b>[R]</b> Pick up ${pk.label}${note}`;
        context = { icon: 'pickup', label: `Pick up ${pk.label}${v?.note ? ` (${v.note})` : ''}` };
      } else if (it) {
        const talk = isCounter(it.kind);
        const sw = it.kind === 'switch' || it.kind === 'power';
        const verb = talk ? 'Talk' : it.kind === 'switch' ? (it.active ? '' : 'Press') : sw ? 'Pull' : 'Use';
        if (it.kind === 'pylon') {
          prompt = `<b>[R]</b> ${it.label}`;
          context = { icon: 'switch', label: it.label };
        } else if (verb) {
          prompt = `<b>[R]</b> ${verb}: ${it.label}`;
          context = { icon: talk ? 'talk' : sw ? 'switch' : 'teleport', label: `${verb}: ${it.label}` };
        }
      } else if (this.nearestBox()) {
        prompt = `<b>[R]</b> Break box`;
        context = { icon: 'crate', label: 'Break box' };
      }
    }

    const buffs: string[] = [];
    if (p.buffs.atp.t > 0) buffs.push(`▲ATP ${Math.ceil(p.buffs.atp.t)}s`);
    if (p.buffs.dfp.t > 0) buffs.push(`▲DFP ${Math.ceil(p.buffs.dfp.t)}s`);
    const statuses: { label: string; cls: string }[] = [];
    if (p.corruption > 0) statuses.push({ label: `CORRUPT ×${p.corruption}${p.inLight ? '' : ' · LIGHT'}`, cls: 'corrupt' });
    if (p.burnStacks > 0) statuses.push({ label: `BURN ×${p.burnStacks}${p.moving ? '' : ' · MOVE'}`, cls: 'burn' });
    if (p.poison > 0) statuses.push({ label: `POISON ${Math.ceil(p.poison)}s`, cls: 'poison' });
    if (p.paralysis > 0) statuses.push({ label: `PARALYSIS ${p.paralysis.toFixed(1)}s`, cls: 'para' });
    else if (p.paraImmune > 0) statuses.push({ label: `PARA WARD ${Math.ceil(p.paraImmune)}s`, cls: 'ward' });

    const c = p.castChain.committed ? p.castChain : p.combo;
    const inj = ch.injector();
    const st = inj && injectorStats(inj, ch);
    const injector = inj && st ? { kind: st.kind, doses: st.doses, charge: chargeOf(inj, ch), name: itemName(inj), mod: st.mod ? INJECTOR_MODS[st.mod].name : null } : null;
    if (p.brace > 0) buffs.push(`▼DMG ${Math.ceil(p.brace)}s`);
    if (p.clarity > 0) buffs.push(`FREE CAST ${Math.ceil(p.clarity)}s`);
    if (p.shield > 0) buffs.push(`◆SHIELD ${Math.ceil(p.shield)}`);
    if (p.slipstream > 0) buffs.push(`★PERFECT ${Math.ceil(p.slipstream)}s`);
    if (p.retaliate > 0) buffs.push('▲RETALIATE');
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      trueMaxHp: p.trueMaxHp,
      shield: p.shield,
      tp: p.tp,
      maxTp: p.maxTp,
      level: ch.level,
      calm: this.calm,
      palette,
      paletteIndex: idx,
      spell: { name: techniques[selTech].name, icon: techIcon(selTech) },
      context,
      comboHits: c.phase === 'swing' ? c.hitIndex + 1 : 0,
      comboStreak: c.phase === 'swing' ? c.streak : 0,
      comboWindow: c.inWindow,
      comboBroken: c.phase === 'swing' && c.broken && !c.sealed,
      target: shown
        ? {
            name: shown.name,
            race: shown.race,
            statuses: shown.statusTimers?.() ?? [],
            affixes: shown instanceof Enemy ? this.affixChips(shown) : [],
            champion: shown instanceof Enemy && shown.champion,
          }
        : null,
      boss:
        boss && boss.engaged && (boss.alive || boss.deadT < 3)
          ? { name: boss.name + (boss.alive ? (boss.hudNote ?? '') : ''), race: boss.race, weak: boss.weakPointOpen }
          : null,
      area: this.hard ? `${world.def.name} (Nightmare)` : world.def.name,
      roomInfo: this.roomInfo,
      prompt,
      buffs,
      statuses,
      cast: p.channel ? p.channel.t / p.channel.dur : p.cast && !p.cast.fired ? p.cast.t / p.cast.windup : null,
      injector,
      dash: { charges: p.dashCharges, max: p.maxDashCharges, refill: p.dashRefill },
    };
  }
}
