import * as THREE from 'three';
import type GUI from 'lil-gui';
import { initAudio, music, setListener, setMuffled, setSpace, sfx, type SfxId } from '../audio';
import { Input } from '../engine/Input';
import { Hud, type HudState, type PaletteSlotView } from '../ui/Hud';
import { techIcon, weaponIcon } from '../ui/icons';
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
import { hellOpen, nightmareOpen, TitleMenu } from '../ui/title';
import { DIFFICULTY_NAME, difficultyTag, runDifficulty, type Difficulty } from './difficulty';
import { AudioCues } from './audioCues';
import { CameraRig } from './CameraRig';
import { Character, dropVerdict, itemName, makeItem, rarityOf, readAffixData, sellPrice, type DropVerdict, type ItemInstance, type UnitKind } from './character';
import { craftWith, salvageYield, upgradeCrafting } from './crafting';
import { angleDelta, yawTo } from './collision';
import { Combat } from './combat/Combat';
import { CC_KINDS, type CcKind } from './ccResist';
import type { Hittable } from './combat/types';
import type { ComboEvent } from './combo';
import { expeditionFoe, type Foe } from './dps';
import { fightLog, hex } from './fightLog';
import { affixes as affixCfg, hard as hardCfg, hell as hellCfg, camera as camCfg, comboDamage, dash as dashCfg, debug, formulas, injectorCfg, lockOn, magCfg, passiveCfg, player as playerCfg, pylonCfg, uniqueCfg } from './config';
import { AFFIXES } from './data/affixes';
import { areas, DEFAULT_LIGHT, expeditionOf, expeditionOfBoss, expeditionOpenedBy, expeditions, isCounter, type AreaId, type ExpeditionId } from './data/areas';
import { BOSS_IDS, BOSSES, isMainBoss, type BossDef, type BossId } from './data/bosses';
import { areaDef } from './data/looks';
import { STAT_KEYS, statDelta, type MagStat } from './data/stats';
import { ART_IDS, ARTS, type ArtId } from './data/arts';
import { getDef, INJECTOR_MODS, PHOTON_STACK, type WeaponKind } from './data/items';
import { affixText, tierIlvl, type AffixRoll } from './data/itemAffixes';
import { UNIQUES } from './data/uniques';
import { CORRUPT_COLOR, Enemy, type EnemyContext } from './enemies/Enemy';
import {
  buyPrice, rollArmor, rollBoxDrop, rollBossDrops, rollChampionBonus, rollEliteBonus, rollEnemyDrops, rollRiftCache, rollRiftEndDrops, rollUnit, rollWeapon,
  shopCopy, shopStock, type Drop, type ShopKind, type ShopUnlocks,
} from './loot';
import { addCharge, chargeOf, doseAmount, fillInjector, injectorDef, injectorStats, spendDose } from './injectors';
import { magForm, PHOTON_BLASTS, type PhotonBlastId } from './mag';
import { skillPoints } from './skills';
import { playerLook } from './models/heroine';
import { Player } from './Player';
import { deleteSlot, listSlots, saveSlot } from './save';
import { testCharacter } from './testCharacters';
import { Breakable } from './world/Breakable';
import { Atmosphere } from './world/Atmosphere';
import { DashTrail, Lob, Pillar, Ring, Tracer } from './world/Effects';
import { inShape, type Telegraph } from './world/Telegraph';
import { Interactable } from './world/Interactable';
import type { Pickup } from './world/Pickup';
import { newRiftRun, newRun, World, type RunState } from './world/World';
import {
  modText, RIFT_MODS, riftBonus, riftBossId, riftBossXp, riftFoe, riftIlvl, riftLoot, riftName, riftSave, riftsOpen, setRiftAreas, syncRiftDepth,
  type RiftInfo,
} from './rifts';
import { circleName, circleOf, rollBossUnique } from './riftCircles';
import { RIFT_GEN } from './riftGen';
import {
  CACHE_NAME, clearNode, deepestNode, enterBlock, isRoomKind, MAP_NODES, mapCfg, mapDepth, nodeName, nodeRift, openWholeMap, payEntry, PINNACLE_BOSS, QUARTERS,
} from './riftMap';
import { RiftMapMenu } from '../ui/riftGate';

/** LMB: the basic chain. RMB, Q, E, R: the Art bar's four slots (2026-10-14, the Arts redesign). */
const BASIC_KEY = 'Mouse0';
const ART_KEYS = ['Mouse2', 'KeyQ', 'KeyE', 'KeyR'] as const;
const ART_KEY_LABELS = ['RMB', 'Q', 'E', 'R'];
const DROP_MARK: Record<DropVerdict['mark'], string> = { '': '', up: '▲', down: '▼', same: '=', no: '✖' };

type SpawnAt = 'start' | { x: number; z: number };

/** Stand-in when there is no world to show a telegraph in. */
const noTelegraph = { cancel: () => {} };

/** Each weapon kind's bolt sound. */
const ATTACK_SFX: Record<WeaponKind, SfxId> = { rod: 'swing.blunt', wand: 'swing.blunt' };

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

  char: Character = Character.create('Nobody');
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
  /** The Falz Rift open this session (DESIGN.md "Endgame: Falz Rifts"): opening another collapses it. */
  private riftRun: RunState | null = null;
  /** Kills in the open Rift Map node (a Gauntlet's cache grows with them). */
  private nodeKills = 0;
  /** Photon kinds whose stack was full when one was walked over (told once per area). */
  private photonFullTold = new Set<string>();
  /** Session difficulty, picked at login: Nightmare (the run state's `hard` flag) for every expedition. */
  private hard = false;
  /** Hell (also sets `hard`): picked at login once Dark Falz falls on Nightmare. */
  private hell = false;
  /** The fight log: seconds to the next position sample, and the boss state last logged. */
  private traceT = 0;
  private traceBoss = '';

  /** The session's difficulty. */
  private get diff(): Difficulty {
    return this.hell ? 'hell' : this.hard ? 'nightmare' : 'normal';
  }
  /** Boss HP last frame (damage to the boss charges injectors). */
  private bossHpSeen = -1;
  /** Seconds since the last fight ended (out-of-combat injector recharge starts after injectorCfg.calmDelay). */
  private calmT = 0;
  private stock: Record<ShopKind, ItemInstance[]> = { weapon: [], armor: [], item: [] };
  private playing = false;

  private last = performance.now();
  private hitstop = 0;
  /** The enemy the camera looks at, within reach of the bar (pickCamTarget, every frame): the target and its frame. */
  private camTarget: Hittable | null = null;
  /** Space went down and hasn't dashed yet (it waits for a direction while held). */
  private dashArmed = false;
  /** Enemy telegraphs the current dash started in (Slipstream checks them when it ends). */
  private slipFrom: Telegraph[] | null = null;
  /** The swing that just started lands perfect (Slipstream): its hit gets one more streak step. */
  private slipHit = false;
  private lastDashHint = -Infinity;
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
      camTarget: () => this.camTarget,
      moveDir: () => this.moveDir,
      cameraYaw: () => this.rig.yaw,
      float: (p, t, c) => this.hud.float(p, t, c),
      log: (h) => this.hud.pushLog(h),
      hitstop: (s) => (this.hitstop = Math.max(this.hitstop, s)),
      shake: (m) => this.rig.shake(m),
      onKill: (t) => this.onKill(t),
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
      claimAffixArea: (sec) => this.world?.claimAffixArea(sec) ?? true,
      tryStrike: (e) => this.combat.enemyStrike(e),
      onDot: (e, d, kind) => this.combat.burnTick(e, d, kind),
      telegraph: (shape, dur, onFire, color) => this.world?.addTelegraph(shape, dur, onFire, color) ?? noTelegraph,
      areaStrike: (e, shape, mult, kb, status, chance) => {
        // Molten: wherever its area attacks land, the ground burns.
        if (e.hasAffix('molten')) this.world?.moltenMark(shape);
        return this.combat.enemyArea(e, shape, mult, kb, status, chance);
      },
      shotStrike: (e, shape, mult, kb, status, chance) => {
        if (e.hasAffix('molten')) this.world?.moltenMark(shape);
        return this.combat.enemyArea(e, shape, mult, kb, status, chance, true);
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
      giveWeapon: () => this.giveItem(rollWeapon(1 + Math.floor(this.rng() * 3), this.rng)),
      giveRare: () => {
        // A rare (yellow) weapon, frame or barrier at your level's gear tier (the highest tier whose item level
        // you've reached).
        let tier = 1;
        for (let t = 1; t <= 15; t++) if (tierIlvl(t) <= this.char.level) tier = t;
        this.giveItem(this.rng() < 1 / 3 ? rollWeapon(tier, this.rng, 'rare') : rollArmor(tier, this.rng, 'rare'));
      },
      giveUnit: () => this.giveItem(rollUnit(Math.max(1, Math.min(15, Math.ceil(this.char.level / 7))), this.rng)),
      givePhotons: () => {
        for (const id of ['photon_drop', 'photon_sphere', 'photon_crystal']) this.giveItem(makeItem(id, { qty: 5 }));
      },
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
      unlockHell: () => {
        const st = this.char.data.stats;
        st.hardKills ??= {};
        st.hellKills ??= {};
        for (const id of BOSS_IDS) {
          st.bossKills[id] = Math.max(1, this.char.bossKills(id, 'normal'));
          st.hardKills[id] = Math.max(1, this.char.bossKills(id, 'nightmare'));
          st.hellKills[id] = Math.max(1, this.char.bossKills(id, 'hell'));
        }
        this.showRiftGate();
        this.hud.toast('Hell is unlocked for this character (every expedition): pick it at login.', 'good');
      },
      riftMapAll: () => {
        this.openRiftsForDebug();
        const save = riftSave(this.char.data);
        openWholeMap(save.map!);
        syncRiftDepth(save);
        this.hud.toast('Every node on the Rift Map is open.', 'good');
      },
      riftResonance: () => {
        this.openRiftsForDebug();
        const save = riftSave(this.char.data);
        for (const q of QUARTERS) save.map!.res[q.boss] = mapCfg.resonanceCap;
        this.hud.toast('Full Resonance for every boss.', 'good');
      },
      riftPinnacle: () => {
        this.openRiftsForDebug();
        const map = riftSave(this.char.data).map!;
        map.nodes.P2NE ??= { s: 'open' };
        this.openRift(nodeRift(map, 'P2NE'), 'riftBoss');
      },
      riftOpen: (boss) => {
        // The deepest node reached of that kind (a boss takes no Resonance here).
        this.openRiftsForDebug();
        const map = riftSave(this.char.data).map!;
        const id = deepestNode(map, boss) ?? (boss ? 'NB1' : 'N1');
        this.openRift(nodeRift(map, id), boss ? 'riftBoss' : 'rift');
      },
      fightLog: () => {
        const p = this.player;
        const header = {
          exported: new Date().toISOString(),
          area: this.world?.areaId,
          difficulty: this.diff,
          rift: this.run.rift ? { tier: this.run.rift.tier, mods: this.run.rift.mods } : undefined,
          level: this.char.level,
          maxHp: p.trueMaxHp,
          radius: p.radius,
          boss: this.world?.boss ? { id: this.world.boss.id, name: this.world.boss.name, hp: this.world.boss.hp / this.world.boss.maxHp, tempo: this.world.boss.tempo } : undefined,
        };
        const stamp = header.exported.replace(/[:.]/g, '-').slice(0, 19);
        return { name: `fight-log-${stamp}.json`, text: fightLog.json(header) };
      },
      clearFightLog: () => fightLog.clear(),
      riftBoss: () => {
        // Skip to the open node's end (its Guardian room, Vault or Gauntlet, or its boss); with none open, the
        // deepest boss node reached.
        const r = this.riftRun?.rift;
        if (r && !r.complete && r.boss) {
          this.enterArea('riftBoss', 'start');
        } else if (r && !r.complete) {
          if (this.world?.areaId !== 'rift') this.enterArea('rift', 'start');
          this.warpToGuardian();
        } else {
          this.openRiftsForDebug();
          const map = riftSave(this.char.data).map!;
          this.openRift(nodeRift(map, deepestNode(map, true) ?? 'NB1'), 'riftBoss');
        }
      },
      testCharacter: () => {
        const slot = listSlots().findIndex((s) => !s);
        if (slot < 0) {
          this.hud.toast('No empty save slot for a test character.', 'warn');
          return;
        }
        const data = testCharacter();
        saveSlot(slot, data);
        // On the title screen, show it in the slot list.
        if (!this.playing) this.openTitle();
        else this.hud.toast(`${data.name} saved to slot ${slot + 1}: pick it at the title screen.`, 'good');
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
          if (data) this.startCharacter(slot, new Character(upgradeCrafting(readAffixData(data))), difficulty);
        },
        create: (slot, name, appearance) => {
          const ch = Character.create(name, appearance);
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
    this.hell = difficulty === 'hell' && hellOpen(ch.data);
    this.hard = this.hell || (difficulty === 'nightmare' && nightmareOpen(ch.data));
    this.player.setCharacter(ch);
    this.runs = {};
    this.riftRun = null;
    this.run = newRun('forest', this.hard, this.hell);
    this.deathT = -1;
    this.player.resetState();
    this.player.clearBuffs();
    this.playing = true;
    this.hud.visible = true;
    this.menus.close();
    this.enterArea('city', 'start');
    this.input.requestLock();
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
        <tr><td>LMB</td><td>Basic chain (refills TP)</td><td>RMB / Q / E / R</td><td>Arts</td></tr>
        <tr><td>Space + WASD</td><td>Dash</td><td>Space</td><td>Talk / pick up / use</td></tr>
        <tr><td>Tab</td><td>Lock-on / next target</td><td>1</td><td>Injector</td></tr>
        <tr><td>C</td><td>Camera behind</td><td></td><td></td></tr>
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

  /** Debug: count a Hell Dark Falz kill so the Rift Gate stands, and show it now if we're in Pioneer 2. */
  private openRiftsForDebug(): void {
    const kills = (this.char.data.stats.hellKills ??= {});
    kills.falz = Math.max(1, kills.falz ?? 0);
    this.showRiftGate();
  }

  /** The city builds its features on entry: rebuild it so a just-unlocked Rift Gate appears. */
  private showRiftGate(): void {
    if (this.world?.areaId === 'city' && riftsOpen(this.char.data)) this.enterArea('city', 'start');
  }

  // ============================================================== areas

  private enterArea(id: AreaId, spawn: SpawnAt): void {
    this.photonFullTold.clear();
    this.combat.ufx.reset();
    if (this.world) {
      this.world.resetActiveRoom();
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    const def = areaDef(id);
    fightLog.push('area', { id, difficulty: this.diff });
    const inRift = id === 'rift' || id === 'riftBoss';
    if (inRift && !this.riftRun) {
      // No rift open (it can't be reached without one): back to the city.
      this.enterArea('city', 'start');
      return;
    }
    const exp = inRift ? null : expeditionOf(id);
    if (inRift) {
      this.run = this.riftRun!;
      if (id === 'riftBoss') this.run.floor = 1;
    } else if (exp) {
      // Every floor reached is a checkpoint: the furthest one is where the city teleporter brings you back.
      this.run = this.runOf(exp);
      this.run.floor = Math.max(this.run.floor, expeditions[exp].floors.indexOf(id));
    }
    const run = def.kind === 'city' ? newRun('forest', this.hard, this.hell) : this.run;
    // Hell, and the Ruins on every difficulty (2026-10-09, the user's call): every landed hit can corrupt.
    this.combat.hellCorrupt = def.kind !== 'city' && (run.hell || exp === 'ruins') ? hellCfg.corruptChance : 0;
    this.combat.corruptWearMult = def.kind !== 'city' && run.rift?.mods.includes('corruption') ? 2 : 1;
    this.world = new World(id, run, {
      enemyCtx: this.enemyCtx,
      bossCtx: {
        playerX: 0,
        playerZ: 0,
        playerAlive: true,
        rng: this.rng,
        telegraph: (shape, dur, onFire, color, dash) => {
          if (dash) this.dashHint();
          // The fight log: the warning (and the boss's state), then where you stood when it fired.
          const id = fightLog.teleId();
          fightLog.push('tele', { id, st: this.world?.boss?.traceState, dur, c: hex(color), dash: dash || undefined, shape });
          const fire = () => {
            const p = this.player;
            fightLog.push('fire', { id, x: p.pos.x, z: p.pos.z, inside: inShape(shape, p.pos.x, p.pos.z, p.radius) });
            onFire();
          };
          const t = this.world?.addTelegraph(shape, dur, fire, color, dash);
          if (!t) return noTelegraph;
          // Chill slows the boss and its telegraphs alike.
          const boss = this.world?.boss;
          if (boss) t.rate = () => boss.tempo;
          return t;
        },
        hitPlayer: (shape, mult, fx, fz, kb, status, chance) => {
          const boss = this.world?.boss;
          if (!boss) return false;
          const hit = this.combat.bossHit(boss, shape, mult, fx, fz, kb, status, chance);
          fightLog.push('bossHit', { st: boss.traceState, mult, hit, iframes: this.player.iframes > 0 || undefined, shape });
          return hit;
        },
        tickPlayer: (shape, dmg, fx, fz) => this.combat.bossTick(shape, dmg, fx, fz),
        puddle: (x, z, r, life) => this.world?.addPuddle(x, z, r, life),
        hazardHit: (dmg, fx, fz, kb, source) => this.combat.hazardHurt(dmg, fx, fz, kb, source),
        burnPlayer: (n) => this.combat.applyPlayerStatus('burn', n),
        paralyse: (chance) => {
          if (this.rng() < chance) this.combat.applyPlayerStatus('paralysis');
        },
        corruptPlayer: (n) => this.combat.applyPlayerStatus('corrupt', n),
        mechanicHit: (share, fx, fz, kb, source) => this.combat.mechanicHurt(share, fx, fz, kb, source),
        lightAt: (x, z, r) => this.world?.lightAt(x, z, r) ?? false,
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
        if (this.combat.enemyArea(e, shape, affixCfg.volatileAtpMult, 8, undefined, 1, true)) this.combat.applyPlayerStatus('burn', affixCfg.volatileBurn);
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
      onRoomCleared: (room) => {
        // A rift without a boss closes when its Guardian room is cleared.
        const rift = this.run.rift;
        if (room.def.guardian && rift && !rift.boss) {
          const q = room.rect;
          this.completeRift((q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2);
        }
        this.roomInfo = null;
        this.cleanse();
        this.combat.ufx.roomCleared();
        this.hud.toast('Room cleared. The gates open.', 'good');
        sfx('gate.open');
        sfx('jingle.clear');
        music.setBattle(false);
      },
      onEvent: (text) => this.hud.pushLog(`<span class="l-proc">${text}</span>`),
      rng: this.rng,
      hideFeature: (kind) => kind === 'riftGate' && !riftsOpen(this.char.data),
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
    this.bossHpSeen = -1;
    // Only Pioneer 2 tops every injector up.
    if (def.kind === 'city') this.refillInjectors();
    this.player.yaw = def.kind === 'boss' || def.kind === 'city' ? Math.PI : 0;
    if (def.startYaw !== undefined && spawn === 'start') this.player.yaw = def.startYaw;
    this.rig.snapBehind(this.player.yaw);
    this.rig.teleport();
    this.camTarget = null;
    this.roomInfo = null;
    this.hud.clearFloats();
    this.hud.banner(def.name + (run.rift ? '' : difficultyTag(runDifficulty(run))));
    if (run.rift && (id === 'rift' || (id === 'riftBoss' && run.rift.boss)) && spawn === 'start') this.announceRift(run.rift);
    this.playAreaMusic();
    setSpace(areas[id].audio.space);

    if (def.kind === 'city') {
      // Bosses beaten open shop tiers (BOSSES[id].shop / hardShop).
      const u: ShopUnlocks = { hard: {}, hell: {} };
      for (const id of BOSS_IDS) {
        u[id] = this.char.bossKills(id, 'normal') > 0;
        u.hard![id] = this.char.bossKills(id, 'nightmare') > 0;
        u.hell![id] = this.char.bossKills(id, 'hell') > 0;
      }
      this.stock = {
        weapon: shopStock('weapon', this.char.level, this.rng, u),
        armor: shopStock('armor', this.char.level, this.rng, u),
        item: shopStock('item', this.char.level, this.rng, u),
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
    return (this.runs[exp] ??= newRun(exp, this.hard, this.hell));
  }

  /** Start `exp` over from its first floor (a fresh run). */
  private newExpedition(exp: ExpeditionId): void {
    this.runs[exp] = newRun(exp, this.hard, this.hell);
    this.enterArea(expeditions[exp].floors[0], 'start');
  }

  /** The city teleporter: back to the furthest floor reached, or a fresh run once the boss has fallen. */
  private resumeExpedition(exp: ExpeditionId): void {
    const r = this.runs[exp];
    if (!r || r.bossDefeated) this.newExpedition(exp);
    else this.enterArea(expeditions[exp].floors[r.floor], 'start');
  }

  /** Take a floor teleporter deeper. */
  private goDeeper(dest: AreaId): void {
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
      const hudDt = this.paused ? 0 : realDt;
      this.rig.update(hudDt, this.player.pos);
      // The camera just moved: what it looks at now is the target for the HUD and the next frame's attacks.
      if (!this.paused) this.camTarget = this.pickCamTarget();
      const right = this.rig.right(this.tmpB);
      setListener(this.player.pos.x, this.player.pos.z, right.x, right.z);
      this.sun.position.set(this.player.pos.x + 12, 25, this.player.pos.z + 8);
      this.sun.target.position.copy(this.player.pos);
      const tg = this.camTarget;
      this.hud.update(
        hudDt,
        this.hudState(),
        this.camera,
        tg && tg.alive ? this.tmpA.copy(tg.pos).setY(tg.aimHeight) : null,
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
      return;
    }

    const f = this.rig.forward(this.tmpA);
    const r = this.rig.right(this.tmpB);
    if (inp.isDown('KeyW')) this.moveDir.add(f);
    if (inp.isDown('KeyS')) this.moveDir.sub(f);
    if (inp.isDown('KeyD')) this.moveDir.add(r);
    if (inp.isDown('KeyA')) this.moveDir.sub(r);
    if (this.moveDir.lengthSq() > 0) this.moveDir.normalize();

    if (inp.wasPressed('KeyC')) this.rig.snapBehind(p.yaw);
    if (inp.wasPressed('Digit1')) this.useInjector();
    // Space interacts when something is in reach (even mid-move); otherwise it arms a dash.
    const spaceUsed = inp.wasPressed('Space') && this.interact();
    this.handleDash(spaceUsed);

    if (inp.wasPressed(BASIC_KEY)) {
      this.hud.pulseSlot(0);
      this.pressBasic();
    }
    ART_KEYS.forEach((key, i) => {
      if (!inp.wasPressed(key)) return;
      this.hud.pulseSlot(i + 1);
      this.pressArt(i);
    });
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
    const lock = this.camTarget;
    let orbit = null;
    if (lock?.alive) {
      // With a target: W / S close in or back off, A / D circle it.
      const fwd = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
      const side = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
      const n = Math.hypot(fwd, side) || 1;
      orbit = { x: lock.pos.x, z: lock.pos.z, fwd: fwd / n, side: side / n };
    }
    const from = p.pos.clone();
    const inside = this.char.hasPassive('slipstream') ? this.telegraphsAround() : [];
    if (!p.startDash(this.moveDir.x, this.moveDir.z, orbit, { blink: this.char.hasPassive('blink') })) return;
    this.slipFrom = inside.length ? inside : null;
    const st = this.char.data.stats;
    st.dashes = (st.dashes ?? 0) + 1;
    sfx('player.dash');
    this.world?.addEffect(new DashTrail(from, p.pos, dashCfg.duration));
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
    p.slipstream = passiveCfg.slipstreamTime;
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

  /** LMB: the basic chain (swing, shot or photon bolt). */
  private pressBasic(): void {
    if (this.world?.def.kind === 'city') return;
    this.handleCombo(this.player.pressStep('basic'));
  }

  /** RMB / Q / E / R: the Art in that bar slot (TP and cooldown first; in Pioneer 2 only support techniques). */
  private pressArt(slot: number): void {
    const id = this.char.artInSlot(slot);
    const p = this.player;
    if (!id) {
      this.hud.float(this.tmpA.copy(p.pos).setY(2.3), this.char.artBar()[slot] ? "Can't use that with this weapon" : 'Empty slot (Menu → Arts)', 'early');
      return;
    }
    if (this.world?.def.kind === 'city' && ARTS[id].role !== 'support') return;
    if (!p.canAct) return;
    // Pressing while the chain can't take a step yet breaks it (PSO's anti-mash) without spending anything.
    const next = p.combo.phase === 'idle' ? 0 : p.combo.hitIndex + 1;
    if (p.combo.canChainNow) {
      const blocked = this.combat.artBlocked(id, next);
      if (blocked) {
        this.hud.float(this.tmpA.copy(p.pos).setY(2.3), blocked, 'early');
        return;
      }
    }
    this.handleCombo(p.pressStep(id));
  }

  // ============================================================== update

  private update(dt: number): void {
    const p = this.player;
    const world = this.world!;
    const events = p.update(dt, this.moveDir);
    this.checkSlipstream();
    if (formulas.tpRegen > 0 && p.alive) p.tp = Math.min(p.maxTp, p.tp + formulas.tpRegen * dt);
    this.handleCombo(events);
    this.combat.tickPlayerStatus(dt);

    world.update(dt, p);
    this.traceFight(world, dt);
    this.tickInjectors(world, dt);
    this.autoPhotonBlast(world);
    this.cues.update(world);
    if (p.stepped) sfx(areas[world.areaId].audio.step);
    const inWindow = p.combo.inWindow;
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

    this.refreshDropVerdicts();
    // Walk-over pickups: meseta, photons (crafting currency) and units worth learning (no bag slot;
    // one learned at least as well stays put, to pick up by hand).
    for (const pk of [...world.pickups]) {
      const c = pk.content;
      const type = c.kind === 'item' ? getDef(c.item.id).type : null;
      const walkOver = c.kind !== 'item' || type === 'photon' || (type === 'unit' && this.char.unitStatus(c.item) !== 'known');
      if (!walkOver) continue;
      if (p.alive && Math.hypot(pk.pos.x - p.pos.x, pk.pos.z - p.pos.z) < 1.2) this.takePickup(pk);
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
    // Rifts: the Starved modifier slows every charge source.
    if (this.world?.def.kind !== 'city' && this.run.rift?.mods.includes('starved')) doses *= 0.7;
    if (inj && doses > 0) addCharge(inj, doses, this.char);
  }

  /** The player's damage on a field enemy: its share of the enemy's HP bar, in doses. Bosses are tracked by HP below. */
  private chargeFromDamage(t: Hittable, dealt: number): void {
    if (!(t instanceof Enemy) || t.noReward || t.noCharge || t.maxHp <= 0) return;
    const share = (dealt / t.maxHp) * (t.elite ? injectorCfg.eliteChargeMult : 1);
    // HP/Drain's cost: your damage no longer charges the injector.
    if (!this.char.hasUnique('hpDrain')) this.chargeInjectors(share * injectorCfg.chargePerEnemy * this.char.pMult('bloodlust', passiveCfg.bloodlustMult));
    this.chargePhotonBlast(share * magCfg.pbChargePerEnemy);
  }

  /** Fill the photon blast gauge (only once the Mag has one picked). */
  private chargePhotonBlast(amount: number): void {
    const p = this.player;
    if (amount <= 0 || !this.photonBlastName()) return;
    // V801: it charges faster.
    if (this.char.hasUnique('v801')) amount *= 1 + this.char.uval(uniqueCfg.v801Charge);
    const before = p.pb;
    p.pb = Math.min(1, p.pb + amount);
    if (before < 1 && p.pb >= 1) sfx('mag.hungry');
  }

  /** The photon blast the Mag fires, or null. */
  private photonBlastName(): string | null {
    const pb = this.char.photonBlast;
    return pb ? PHOTON_BLASTS[pb].name : null;
  }

  /**
   * The photon blast fires by itself once its gauge is full, in a fight (a sealed room or an engaged boss), when
   * the player can act (2026-10-11, the user's call; it was key 2). Mylla & Youlla waits until an enemy is within
   * its reach, so it never fires into empty air.
   */
  private autoPhotonBlast(world: World): void {
    const p = this.player;
    if (p.pb < 1 || !p.alive || p.paralyzed || this.calm || world.def.kind === 'city' || !this.photonBlastName()) return;
    if (this.char.photonBlast === 'mylla') {
      const reach = magCfg.pbMyllaRange;
      if (!world.targets().some((e) => !e.invulnerable && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - e.radius <= reach)) return;
    }
    this.combat.photonBlast();
  }

  private tickInjectors(world: World, dt: number): void {
    // A few seconds after a fight HP, TP and the injector refill completely (Pioneer 2 refills them at once).
    // 2026-10-11, the user's call: with the injector already free out of combat, topping up by hand was a chore.
    if (this.calm && this.player.alive && world.def.kind !== 'city') {
      this.calmT += dt;
      const p = this.player;
      const inj = this.char.injector();
      const injLow = !!inj && chargeOf(inj, this.char) < injectorStats(inj, this.char).doses;
      const debuffed = p.corruption > 0 || p.poison > 0 || p.burnStacks > 0 || p.paralysis > 0;
      if (this.calmT >= injectorCfg.calmDelay && (injLow || debuffed || p.hp < p.maxHp || p.tp < p.maxTp)) {
        // Every debuff goes too (2026-10-11, the user's call): poison, Burn, paralysis, and Corruption that landed
        // after the room's clear-cleanse (a death blast, a shot in flight), whose lowered max would leave HP short.
        this.cleanse();
        p.poison = 0;
        p.burnStacks = 0;
        p.burnDecay = 0;
        p.paralysis = 0;
        // Standing in a marsh or slag pool keeps re-applying: the next restore waits for another calm delay.
        this.calmT = 0;
        if (inj) fillInjector(inj);
        p.hp = p.maxHp;
        p.tp = p.maxTp;
        sfx('item.drink', { pitch: 1.4 });
        this.hud.float(this.tmpA.copy(p.pos).setY(2.6), 'RESTORED', 'heal');
      }
    } else this.calmT = 0;
    // Mending (HP) and Spring (TP) affixes: a little back every second, in fights too (between fights the injector covers it).
    // Devil/Battle's cost: gear HP regen does nothing.
    const regen = this.char.hasUnique('devilBattle') ? 0 : this.char.gearAffix('regen') * this.char.healMult();
    const tpRegen = this.char.gearAffix('tpRegen');
    const p = this.player;
    if (regen && p.alive && world.def.kind !== 'city') p.hp = Math.min(p.maxHp, p.hp + regen * dt);
    if (tpRegen && p.alive && world.def.kind !== 'city') p.tp = Math.min(p.maxTp, p.tp + tpRegen * dt);
    // Boss HP lost since last frame (any source the player caused: hits, techs, burns).
    const boss = world.boss;
    if (boss) {
      if (this.bossHpSeen >= 0 && boss.hp < this.bossHpSeen && boss.maxHp > 0) {
        const share = (this.bossHpSeen - Math.max(0, boss.hp)) / boss.maxHp;
        if (!this.char.hasUnique('hpDrain')) this.chargeInjectors(share * boss.injectorCharge * this.char.pMult('bloodlust', passiveCfg.bloodlustMult));
        this.chargePhotonBlast(share * magCfg.pbBossCharge);
      }
      this.bossHpSeen = boss.hp;
    }
  }

  /** Dark Flow: a kill heals a share of max HP and takes a Corruption stack away. */
  private darkFlowKill(): void {
    const p = this.player;
    if (!p.alive || !this.char.hasUnique('darkFlow')) return;
    const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * uniqueCfg.darkFlowHeal * this.char.healMult()));
    if (heal > 0) {
      p.hp += heal;
      this.hud.float(this.tmpA.copy(p.pos).setY(2.2), `+${heal}`, 'heal');
    }
    if (p.corruption > 0) p.corruption--;
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
    const status = p.poison > 0 || p.paralyzed || p.burnStacks > 0;
    if (!p.alive || (p.paralyzed ? !sol : !p.canUseItem)) return;
    const hp = s.kind === 'mate';
    if (hp && this.char.hasUnique('darkFlow')) {
      this.hud.float(at(), "Dark Flow: Mate doesn't work", 'early');
      sfx('ui.error');
      return;
    }
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
    }
    if (s.mod === 'bracing') p.brace = injectorCfg.braceTime;
    if (!hp && this.char.hasPassive('clarity')) {
      p.clarity = this.char.pAmt('clarity', passiveCfg.clarityTime);
      this.hud.float(this.tmpA.copy(p.pos).setY(2.7), 'CLARITY', 'proc');
    }
    sfx('item.drink');
    p.onItemUse(injectorCfg.useLock);
  }

  /** Clear Corruption (a cleared room, a boss kill; not a Sol dose). Max HP comes back; HP doesn't. */
  private cleanse(): void {
    const p = this.player;
    if (p.corruption <= 0) return;
    p.corruption = 0;
    p.corruptDecay = 0;
    p.corruptTimer = 0;
    this.hud.float(this.tmpA.copy(p.pos).setY(2.4), 'CLEANSED', 'heal');
    sfx('status.cleanse');
  }

  /** Last Stand (passive): a free dose from a Mate injector, on top of the 1 HP. */
  private lastStandDose(): void {
    const inst = this.char.injector();
    if (!inst || injectorDef(inst)?.kind !== 'mate') return;
    const p = this.player;
    const amount = doseAmount(injectorStats(inst, this.char), p.maxHp, 1);
    p.addRegen('hp', amount, 0.3);
    this.hud.float(this.tmpA.copy(p.pos).setY(2.2), `+${amount}`, 'heal');
  }

  /** Perfect / broken feedback for the chain. */
  private chainFeedback(events: ComboEvent[], what: string): void {
    const p = this.player;
    for (const ev of events) {
      // Slipstream: the first step after dashing out of a telegraph lands perfect.
      const slip = ev.kind === 'start' && p.slipstream > 0;
      if (slip) {
        p.slipstream = 0;
        this.slipHit = true;
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
          if (ev.step !== 'basic') {
            this.combat.artStart(ev.step as ArtId, ev.hitIndex, ev.perfect);
            if (p.aimYaw === null && this.moveDir.lengthSq() > 0) p.aimYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
            break;
          }
          const target = this.combat.aimTarget();
          p.aimYaw = target ? yawTo(p.pos.x, p.pos.z, target.pos.x, target.pos.z) : this.combat.casterYaw();
          break;
        }
        case 'hit': {
          const streak = this.slipHit ? Math.min(ev.streak + 1, comboDamage.length - 1) : ev.streak;
          this.slipHit = false;
          if (ev.step === 'basic') {
            this.attackSound(ev.hitIndex);
            this.combat.basicStep(ev.hitIndex, streak);
          } else this.combat.artFire(ev.step as ArtId, ev.hitIndex, streak);
          break;
        }
        case 'early':
        case 'end':
          break;
      }
    }
  }

  /** Whoosh / shot for the weapon in hand; finishers sound bigger. */
  private attackSound(hitIndex: number): void {
    const kind = this.char.weaponInstance() ? this.char.weaponKind().kind : null;
    const strong = hitIndex === 2;
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
    this.spawnDrop(rollBoxDrop(this.rng), b.pos.x, b.pos.z);
  }

  /** Junk / upgrade looks of the drops: re-read after a level-up, attribute or Mag point, equip, grind or craft. */
  private refreshDropVerdicts(): void {
    const d = this.char.data;
    // Injectors stay out of the key: their charge changes every hit, and their verdict only needs the stats.
    const worn = (['weapon', 'frame', 'barrier'] as const).map((s) => JSON.stringify(this.char.equippedItem(s) ?? null));
    const key = `${d.level}|${JSON.stringify(d.mag)}|${JSON.stringify(d.skills)}|${JSON.stringify(d.arts)}|${this.run.expedition}|${worn.join('|')}`;
    if (key === this.dropKey) return;
    this.dropKey = key;
    for (const pk of this.world?.pickups ?? []) this.judgeDrop(pk);
  }

  private judgeDrop(pk: Pickup): void {
    if (pk.content.kind === 'item') pk.setVerdict(dropVerdict(this.char, pk.content.item, this.damageFoe()));
  }

  private nearestPickup(): Pickup | null {
    if (!this.world) return null;
    const p = this.player.pos;
    let best: Pickup | null = null;
    let bestD = playerCfg.pickupRange;
    for (const pk of this.world.pickups) {
      if (pk.content.kind !== 'item') continue; // the rest are walk-over
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
    const item = pk.content.item;
    const def = getDef(item.id);
    const took = this.char.take(item);
    if (def.type === 'photon') {
      // A currency: walked over, no bag space; a full stack leaves it lying there (said once per area).
      if (took.to === 'full') {
        if (!this.photonFullTold.has(item.id)) this.hud.toast(`You carry the most <b>${def.name}s</b> you can (${PHOTON_STACK}): spend some first.`, 'warn');
        this.photonFullTold.add(item.id);
        return;
      }
      world.removePickup(pk);
      sfx('pickup.item', { pitch: 1.25 });
      const n = item.qty ?? 1;
      this.hud.float(this.tmpA.copy(pk.pos).setY(1.4), `+${n} ${def.name}${n > 1 ? 's' : ''}`, 'photon');
      return;
    }
    if (took.to === 'full') {
      this.hud.toast('Inventory full!', 'warn');
      sfx('ui.error');
      return;
    }
    world.removePickup(pk);
    if (took.to === 'learned') {
      this.learnedUnit(item, took.before);
      return;
    }
    sfx('pickup.item');
    this.hud.toast(`Picked up <b>${itemName(item)}</b>`, def.rare ? 'rare' : '');
    if (def.rare) this.autosave();
  }

  /** A unit was learned (picked up or given): say what it adds, re-judge the units still lying around, save. */
  private learnedUnit(unit: ItemInstance, before: AffixRoll | null): void {
    sfx('mag.feed');
    const unique = getDef(unit.id).unique;
    if (unique) {
      // A unique unit (Rift Circles): learned for good; it works once slotted on the Mag tab.
      this.hud.toast(`Learned the unique unit <b>${itemName(unit)}</b>: ${UNIQUES[unique].effect}. Slot it on the Mag tab.`, 'rare');
      this.dropKey = '';
      this.autosave();
      return;
    }
    const now = affixText(unit.affixes![0]);
    this.hud.toast(before ? `<b>${itemName(unit)}</b> improved: ${affixText(before)} → ${now}` : `Learned <b>${itemName(unit)}</b>: ${now}`, 'good');
    this.dropKey = '';
    this.autosave();
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
      case 'riftGate':
        this.riftGateMenu();
        break;
      case 'toCity':
        if (this.run.rift && this.world?.def.kind !== 'city') {
          // A rift's teleporters open the Rift Map too, so nodes can be chained without walking back to the Gate.
          const done = this.run.rift.complete;
          this.choice('Teleporter', done ? 'The rift is closed. Where to?' : 'The rift stays open: the Rift Gate brings you back.', [
            { label: 'Rift Map', sub: done ? 'Pick the next node from here' : 'Opening another node collapses this one', run: () => this.openMenu(this.riftMapMenu()) },
            { label: 'Return to Pioneer 2', run: () => this.travel(() => this.enterArea('city', 'start')) },
            cancel,
          ]);
          break;
        }
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
        if (!pylon.light(pylonCfg.litTime)) return;
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
      case 'start':
        break;
    }
  }

  // ============================================================ Falz Rifts

  /** The Rift Gate: only on Pioneer 2 once the Hell Dark Falz has fallen, then open in every session (rifts run on Hell rules). */
  private riftGateMenu(): void {
    const close: ChoiceOption = { label: 'Close', run: () => this.closeMenu() };
    if (!riftsOpen(this.char.data)) {
      this.choice('Rift Gate', 'The air here hums, but nothing answers. Dark Falz still holds Ragol: defeat it on Hell to tear the rifts open.', [close]);
      return;
    }
    this.openMenu(this.riftMapMenu());
  }

  /** The Rift Map (the Rift Gate, and a rift's teleporters): pick a node and go. */
  private riftMapMenu(): RiftMapMenu {
    return new RiftMapMenu({
      char: this.char,
      openRift: () => (this.riftRun?.rift && !this.riftRun.rift.complete ? this.riftRun.rift : null),
      enter: (id: string) => this.enterNode(id),
      returnToRift: () => {
        const r = this.riftRun?.rift;
        if (r) this.travel(() => this.enterArea(r.boss ? 'riftBoss' : 'rift', 'start'));
      },
      closeMenu: () => this.closeMenu(),
    });
  }

  /** Enter a Rift Map node: a boss replay takes its Resonance now, and the rift open before collapses. */
  private enterNode(id: string): void {
    const save = riftSave(this.char.data);
    if (enterBlock(save, id)) return;
    payEntry(save, id);
    save.map!.sel = id;
    const info = nodeRift(save.map!, id);
    this.travel(() => this.openRift(info, info.boss ? 'riftBoss' : 'rift'));
  }

  /** Open a rift: build its areas, collapse the one before, and go in (debug: straight to its boss arena). */
  private openRift(info: RiftInfo, at: 'rift' | 'riftBoss' = 'rift'): void {
    this.riftRun = newRiftRun(info);
    this.nodeKills = 0;
    setRiftAreas(info);
    this.autosave();
    this.enterArea(at, 'start');
  }

  /** Debug: drop the player in the rift floor's Guardian room (its waves start at once). */
  private warpToGuardian(): void {
    const world = this.world!;
    const room = world.level.rooms.find((q) => q.def.guardian);
    if (!room) return;
    const q = room.rect;
    const pos = new THREE.Vector3((q.minX + q.maxX) / 2, 0, (q.minZ + q.maxZ) / 2);
    // The middle may hold a pillar: step outwards until there's floor.
    for (let d = 0; world.level.isSolidAt(pos.x, pos.z) && d < 8; d++) pos.x += d % 2 ? -d : d;
    world.level.resolveCircle(pos, 0.5);
    this.player.pos.copy(pos);
    this.player.resetState();
    this.rig.snapBehind(this.player.yaw);
    this.rig.teleport();
    this.camTarget = null;
  }

  /** On entering a rift: what it holds (two toasts; each modifier's line goes to the log). */
  private announceRift(r: RiftInfo): void {
    const { qty, rar } = riftLoot(r);
    const what = r.boss
      ? 'a first kill in each circle always drops one of its uniques'
      : r.kind === 'vault'
        ? 'a Vault: three champion packs guard it'
        : r.kind === 'gauntlet'
          ? `a Gauntlet: hold out ${RIFT_GEN.hold.time} s, the cache grows with your kills`
          : 'a Guardian waits at the end';
    const cache = r.cache ? ` · ${CACHE_NAME[r.cache]} cache` : '';
    this.hud.toast(`Item level ${riftIlvl(r.tier)} · quantity +${qty}% · rarity +${rar}% · ${what}${cache}`, 'rare');
    if (!r.mods.length) return;
    const m = riftBonus(r.mods);
    this.hud.toast(`${r.mods.map((id) => `<b>${RIFT_MODS[id].name}</b>`).join(' · ')} · modifiers: quantity +${m.qty}% · rarity +${m.rar}%`, 'warn');
    for (const m of r.mods) this.hud.pushLog(`<span class="l-proc">${RIFT_MODS[m].name}: ${modText(m, r.second)}</span>`);
  }

  /** A rift's boss fell: victory, its loot, and the rift closes. */
  private riftBossKilled(def: BossDef, t: Hittable): void {
    const world = this.world!;
    this.char.data.stats.kills++;
    this.cleanse();
    this.run.bossDefeated = true;
    this.camTarget = null;
    music.stop(0.4);
    sfx('jingle.victory');
    this.victoryT = 8;
    this.hud.banner(`${world.boss!.name.toUpperCase()} DEFEATED`, 'boss');
    this.gainXp(riftBossXp(def.id));
    const at = def.dropsAt === 'center' ? world.level.center() : t.pos;
    this.completeRift(at.x, at.z, def.dropRing, def.dropStretch ?? 1);
    world.spawnReturnTeleporter();
  }

  /**
   * A Rift Map node is done (its last room cleared, or its boss down): the map counts it (a room node rolls anew and
   * fills its boss's Resonance; what it links to opens), and its loot drops: the end drop, a room node's cache, a
   * boss's own unique.
   */
  private completeRift(x: number, z: number, ring = 2.2, stretch = 1): void {
    const r = this.run.rift;
    if (!r || r.complete) return;
    r.complete = true;
    const save = riftSave(this.char.data);
    save.clears++;
    const depth = mapDepth(save.map!);
    const opened = MAP_NODES[r.node] ? clearNode(save, r.node) : [];
    syncRiftDepth(save);
    if (!r.boss) {
      sfx('jingle.victory');
      this.hud.banner('RIFT CLOSED', 'boss');
    }
    this.announceOpened(opened, depth);
    const q = MAP_NODES[r.node]?.q;
    const res = !r.boss && q !== undefined ? ` ${BOSSES[QUARTERS[q].boss].name} Resonance +1.` : '';
    this.hud.toast(`${r.boss ? nodeName(r.node) : riftName(r)} closed.${res} Its teleporter opens the Rift Map.`, 'good');
    const ilvl = riftIlvl(r.tier);
    const drops: Drop[] = rollRiftEndDrops(r.boss, r.tier, ilvl, this.rng, riftLoot(r).qty);
    if (r.boss) {
      // Rift Circles: the boss's own unique (its first kill in a circle always drops one).
      const u = rollBossUnique(riftBossId(r), r.tier, ilvl, save, this.char.data, this.rng, riftLoot(r).rar);
      if (u) drops.push({ kind: 'item', item: u });
    } else if (r.cache) {
      // The node's cache: more of its kind (a Vault's twice over, a Gauntlet's grows with the kills).
      const mult = r.kind === 'vault' ? mapCfg.vaultMult : 1;
      const base = r.cache === 'photons' ? mapCfg.spheres : mapCfg.cache;
      const extra = r.kind === 'gauntlet' ? Math.floor(this.nodeKills / mapCfg.killsPerPiece) : 0;
      drops.push(...rollRiftCache(r.cache, base * mult + extra, ilvl, this.rng, mapCfg.crystal * mult));
    }
    drops.forEach((d, i) => {
      const a = (i / drops.length) * Math.PI * 2;
      this.spawnDrop(d, x + Math.sin(a) * ring, z + Math.cos(a) * ring * stretch);
    });
    this.autosave();
  }

  /** Say what a clear opened on the Rift Map (and when a new Rift Circle begins). */
  private announceOpened(opened: string[], depthBefore: number): void {
    if (!opened.length) return;
    const shown = opened.filter((id) => isRoomKind(MAP_NODES[id].kind) || MAP_NODES[id].kind === 'boss');
    const landmarks = opened.filter((id) => !shown.includes(id));
    const save = riftSave(this.char.data);
    const deeper = circleOf(save.tier) > circleOf(depthBefore) ? ` Rift Circle ${circleName(circleOf(save.tier))} begins: its bosses drop new uniques.` : '';
    if (shown.length) this.hud.toast(`New on the Rift Map: ${shown.map(nodeName).join(', ')}.${deeper}`, 'rare');
    for (const id of landmarks) {
      const n = MAP_NODES[id];
      const text = n.kind === 'heart'
        ? 'All four seals of the Heart are broken. What waits there is still to come.'
        : PINNACLE_BOSS[id]
          ? `Pinnacle ${circleName(n.circle)} stands open between two quarters: ${nodeName(id)} waits on Storm Peak. Its first kill is free.`
          : `${nodeName(id)} stands open between two quarters. Its boss is still to come.`;
      this.hud.toast(text, 'rare');
    }
  }

  /** The city teleporter's expedition list for the session's difficulty. */
  private teleporterMenu(): void {
    const diff = this.diff;
    const cancel: ChoiceOption = { label: 'Cancel', run: () => this.closeMenu() };
    const opts: ChoiceOption[] = [];
    const tag = difficultyTag(diff);
    const lastBoss = BOSS_IDS.map((b) => BOSSES[b]).find((b) => b.opensNightmare)!.title;
    for (const exp of Object.values(expeditions)) {
      // Normal: the previous expedition's boss. Nightmare / Hell: Dark Falz one difficulty down for the Forest, then the previous boss on this one.
      let locked: boolean;
      let why = exp.needs ? `Defeat ${BOSSES[exp.needs].title}${diff === 'normal' ? '' : ` on ${DIFFICULTY_NAME[diff]}`} to unlock` : '';
      if (exp.needs) locked = this.char.bossKills(exp.needs, diff) <= 0;
      else if (diff === 'normal') locked = false;
      else {
        locked = diff === 'hell' ? !hellOpen(this.char.data) : !nightmareOpen(this.char.data);
        why = `Defeat ${lastBoss}${diff === 'hell' ? ' on Nightmare' : ''} to unlock`;
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
    this.choice('Teleporter', diff === 'normal' ? 'Where do you want to go?' : `${DIFFICULTY_NAME[diff]}: where do you want to go?`, opts);
  }

  private travel(go: () => void): void {
    sfx('world.teleport');
    this.menus.close();
    go();
    this.input.requestLock();
    this.updateOverlay();
  }

  /** A Gauntlet being held: its clock, then what's left to clear. */
  private holdInfo(): string | null {
    const left = this.world?.holdLeft();
    if (left === null || left === undefined) return null;
    return left > 0 ? `Hold out: ${Math.ceil(left)} s` : 'Clear the rest';
  }

  // ============================================================ killing

  private onKill(t: Hittable): void {
    const world = this.world!;
    if (t instanceof Enemy) {
      // Re-formed Pan Arms halves give nothing, so splitting can't be farmed.
      if (t.noReward) return;
      this.darkFlowKill();
      this.char.data.stats.kills++;
      this.gainXp(t.xp);
      for (const d of rollEnemyDrops(t.arch, this.rng)) this.spawnDrop(d, t.pos.x, t.pos.z);
      if (t.champion) for (const d of rollChampionBonus(t.arch, this.rng)) this.spawnDrop(d, t.pos.x, t.pos.z);
      if (this.run.rift) this.nodeKills++;
      if (t.elite) this.spawnDrop(rollEliteBonus(t.arch, this.rng), t.pos.x, t.pos.z);
      return;
    }
    const boss = world.boss;
    if (boss && boss.owns(t)) {
      // Boss parts share its HP: only the whole boss going down counts.
      if (boss.alive) return;
      this.darkFlowKill();
      const def = BOSSES[boss.id];
      const id = boss.id;
      if (this.run.rift || !isMainBoss(id)) {
        this.riftBossKilled(def, t);
        return;
      }
      const diff = runDifficulty(this.run);
      this.char.data.stats.kills++;
      const first = this.char.addBossKill(id, diff) === 1;
      this.cleanse();
      this.run.bossDefeated = true;
      this.camTarget = null;
      music.stop(0.4);
      sfx('jingle.victory');
      this.victoryT = 8;
      this.hud.banner(`${boss.name.toUpperCase()} DEFEATED`, 'boss');
      this.autosave();
      this.hud.toast('Quest complete! A teleporter to Pioneer 2 has appeared.', 'good');
      if (first) this.announceUnlocks(def, id, diff);
      this.gainXp(diff === 'hell' ? hellCfg.bosses[id].xp : diff === 'nightmare' ? hardCfg.bosses[id].xp : def.xp());
      // Loot lands on the deck / arena floor around the centre, or where it fell.
      const at = def.dropsAt === 'center' ? world.level.center() : t.pos;
      const drops = rollBossDrops(id, diff, this.rng);
      drops.forEach((d, i) => {
        const a = (i / drops.length) * Math.PI * 2;
        this.spawnDrop(d, at.x + Math.sin(a) * def.dropRing, at.z + Math.cos(a) * def.dropRing * (def.dropStretch ?? 1));
      });
      world.spawnReturnTeleporter();
    }
  }

  /** Toasts for what a boss's first kill opened: shop tiers, the next expedition, Nightmare or Hell. */
  private announceUnlocks(def: BossDef, id: BossId, diff: Difficulty): void {
    const shop = (diff === 'hell' ? def.hellShop : diff === 'nightmare' ? def.hardShop : def.shop)[0];
    if (shop) this.hud.toast(`Pioneer 2 shops will now stock tier ${shop.tier} gear (from Lv ${shop.level}).`, 'rare');
    const next = expeditionOpenedBy(id);
    if (next) this.hud.toast(`A new ${diff === 'normal' ? '' : `${DIFFICULTY_NAME[diff]} `}expedition is open: the ${next.name}.`, 'rare');
    if (diff === 'normal' && def.opensNightmare && !this.char.data.stats.nightmareKept) {
      this.hud.toast('Nightmare is open: Save &amp; quit (menu, I) and pick it when you start again.', 'rare');
    }
    if (diff === 'nightmare' && def.opensNightmare) {
      this.hud.toast('Hell is open: Save &amp; quit (menu, I) and pick it when you start again.', 'rare');
    }
  }

  private spawnDrop(d: Drop | null, x: number, z: number): void {
    if (!d || !this.world) return;
    const ox = (this.rng() - 0.5) * 1.2;
    const oz = (this.rng() - 0.5) * 1.2;
    this.judgeDrop(this.world.addPickup(d, x + ox, z + oz));
    if (d.kind === 'item' && (getDef(d.item.id).rare || rarityOf(d.item) === 'rare')) sfx('loot.rare', { x, z });
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
        STAT_KEYS.filter((k) => after[k] !== before[k])
          .map((k) => statDelta(k, after[k] - before[k]))
          .join(' · '),
      );
      this.announceLevelUnlocks(this.char.level - levels, this.char.level);
      if (this.char.maxed) this.hud.toast('Level cap reached: from here, the chase is gear.', 'rare');
      const pts = this.char.magPoints;
      if (pts > 0) {
        this.hud.toast(`Your Mag can learn: ${pts} point${pts > 1 ? 's' : ''} to spend (Menu → Mag).`, 'good');
        sfx('mag.hungry');
      }
    }
  }

  /** What levels `from` (exclusive) to `to` opened: skill points, Arts that can now be learned, the photon blast. */
  private announceLevelUnlocks(from: number, to: number): void {
    const ch = this.char;
    const opened = (lv: number) => lv > from && lv <= to;
    const gained = skillPoints(to) - skillPoints(from);
    if (gained > 0) this.hud.toast(`+${gained} skill point${gained > 1 ? 's' : ''}: ${ch.skillPointsLeft} to spend (Menu → Skills).`, 'rare');
    const arts = ART_IDS.filter((a) => opened(ARTS[a].level));
    if (arts.length) this.hud.toast(`Can be learned now: ${arts.map((id) => `<b>${ARTS[id].name}</b>`).join(', ')} (Menu → Skills).`, 'good');
    if (opened(magCfg.pbLevel)) this.hud.toast('Your Mag can teach a photon blast (Menu → Mag).', 'rare');
    this.player.refreshMag();
  }

  private giveItem(inst: ItemInstance): void {
    const took = this.char.take(inst);
    if (took.to === 'learned') this.learnedUnit(inst, took.before);
    else if (took.to === 'bag') this.hud.toast(`Received <b>${itemName(inst)}</b>`);
    else this.hud.toast('Inventory full!', 'warn');
  }

  private debugKillAll(): void {
    if (!this.world) return;
    for (const h of this.world.hittables()) {
      if (h.invulnerable) continue;
      if (h.damage(h.hp, h.pos.x, h.pos.z, 0, 0)) this.onKill(h);
    }
  }

  /** The fight log (debug panel: export): your position five times a second, and the boss's state as it changes. */
  private traceFight(world: World, dt: number): void {
    fightLog.tick(dt);
    if (areaDef(world.areaId).kind === 'city') return;
    const p = this.player;
    this.traceT -= dt;
    if (this.traceT <= 0 && p.alive) {
      this.traceT = 0.2;
      const e: Record<string, unknown> = { x: p.pos.x, z: p.pos.z, hp: p.hp, max: p.maxHp };
      if (p.inLight) e.light = 1;
      if (p.dash) e.dash = 1;
      if (p.iframes > 0) e.iframes = 1;
      if (p.corruption) e.corrupt = p.corruption;
      fightLog.push('pos', e);
    }
    const boss = world.boss;
    const st = boss?.engaged ? `${boss.traceState}|${boss.name}${boss.hudNote ?? ''}` : '';
    if (boss && st !== this.traceBoss) fightLog.push('boss', { st: boss.traceState, name: boss.name, note: boss.hudNote || undefined, hp: boss.hp / boss.maxHp });
    this.traceBoss = st;
  }

  // ============================================================== death

  private onPlayerHurt(): void {
    if (this.player.alive || this.deathT >= 0) return;
    this.char.data.stats.deaths++;
    fightLog.push('death', { x: this.player.pos.x, z: this.player.pos.z });
    this.camTarget = null;
    sfx('player.death');
    music.stop(1.2);
    this.hud.pushLog('<span class="l-bad">You have fallen.</span>');
    this.deathT = 0;
  }

  private openDeathMenu(): void {
    sfx('jingle.death');
    const floor = areas[expeditions[this.run.expedition].floors[this.run.floor]];
    const rift = this.run.rift;
    const back = rift
      ? `The Rift Gate brings you back into ${rift.boss ? nodeName(rift.node) : riftName(rift)}`
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

  // ============================================================ targeting

  /**
   * What the camera looks at is the target (2026-10-16, the user's ask; Tab lock-on until then): the enemy nearest
   * the middle of the view (measured from the camera, so it matches what's drawn) within lockOn.aimDeg, ahead of her,
   * on screen, in sight (never through walls) and within reach of the attacks on her bar (Combat.targetRange), so its
   * frame shows exactly while an attack can reach it. Nearer ones win near-ties; the current one holds on out to
   * lockOn.holdDeg and wins near-ties too, so two enemies side by side don't flicker.
   */
  private pickCamTarget(): Hittable | null {
    if (!this.world || !this.player.alive || this.world.def.kind === 'city') return null;
    const level = this.world.level;
    const p = this.player.pos;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const range = this.combat.targetRange();
    const yaw = this.rig.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const eye = this.tmpC.set(p.x, p.y + 1.2, p.z);
    const rad = THREE.MathUtils.degToRad;
    let best: Hittable | null = null;
    let bestScore = Infinity;
    for (const e of this.world.targets()) {
      const dx = e.pos.x - p.x;
      const dz = e.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > range) continue;
      if (dx * fx + dz * fz < -e.radius) continue; // behind her (between her and the camera)
      const held = e === this.camTarget;
      const ang = Math.abs(angleDelta(yaw, yawTo(cam.position.x, cam.position.z, e.pos.x, e.pos.z)));
      if (ang > rad(held ? lockOn.holdDeg : lockOn.aimDeg)) continue;
      const score = ang + (0.1 * d) / range - (held ? rad(lockOn.holdBonusDeg) : 0);
      if (score >= bestScore) continue;
      const v = this.tmpD.set(e.pos.x, e.aimHeight, e.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.y) > 1) continue; // off screen (the camera looks down past it)
      const dir = this.tmpD.set(e.pos.x, e.aimHeight, e.pos.z).sub(eye);
      const len = dir.length();
      if (len > 0.01 && level.raycast(eye, dir.divideScalar(len), len) < len - e.radius) continue;
      best = e;
      bestScore = score;
    }
    return best;
  }

  // ============================================================ GameApi

  /** Use a consumable from a quick slot (menus have no Use button: nothing is used with the game paused). */
  useItem(uid: string): string | null {
    const inst = this.char.find(uid);
    if (!inst) return 'No such item';
    const def = getDef(inst.id);
    if (def.type !== 'consumable') return 'Cannot use that';
    if (def.fieldOnly && !this.inField) return `${def.name} only works outside the city`;
    this.char.removeItem(uid, 1);
    sfx('item.drink');
    return null;
  }

  /** Short feedback toast (shown above menus, at the bottom while one is open). */
  notify(text: string, kind: '' | 'good' | 'warn' = ''): void {
    this.hud.toast(esc(text), kind);
    if (kind === 'warn') sfx('ui.error');
  }

  /** Put Mag points into a stat (permanent); the Mag may evolve. */
  magSpend(stat: MagStat, n = 1): string | null {
    const ch = this.char;
    const formBefore = magForm(ch.mag).name;
    const err = ch.spendMag(stat, n);
    if (err) return err;
    this.player.refreshMag();
    this.autosave();
    const form = magForm(ch.mag).name;
    sfx(form !== formBefore ? 'jingle.magEvolve' : 'mag.feed');
    if (form !== formBefore) {
      this.hud.banner(`MAG EVOLVED: ${form.toUpperCase()}`, 'good');
      this.notify(`Your Mag evolved into ${form}!`, 'good');
    }
    return null;
  }

  /** Skills and Art slots change out of a fight (2026-10-14). */
  private get canRebuild(): string | null {
    return this.calm || !this.inField ? null : 'Not in the middle of a fight';
  }

  /** Put ranks into a skill (`step` > 0) or take them out (< 0), up to |step| of them; out of a fight. */
  skillRank(id: string, step: number): string | null {
    const busy = this.canRebuild;
    if (busy) return busy;
    let done = 0;
    let err: string | null = null;
    for (let i = 0; i < Math.abs(step); i++) {
      err = step > 0 ? this.char.rankUp(id) : this.char.rankDown(id);
      if (err) break;
      done++;
    }
    if (!done) return err;
    this.skillsChanged();
    return null;
  }

  private skillsChanged(): void {
    this.player.refreshMag();
    this.player.dashCharges = Math.min(this.player.dashCharges, this.player.maxDashCharges);
    this.autosave();
    sfx('ui.confirm');
  }

  /** Put an Art on a bar slot (null empties it), for the weapon in hand. */
  artSlot(slot: number, id: ArtId | null): string | null {
    const busy = this.canRebuild;
    if (busy) return busy;
    const err = this.char.setArtSlot(slot, id);
    if (err) return err;
    this.autosave();
    sfx('ui.confirm');
    return null;
  }

  /** The photon blast the Mag fires (from magCfg.pbLevel). */
  photonBlastPick(id: PhotonBlastId): string | null {
    if (this.char.level < magCfg.pbLevel) return `The Mag teaches photon blasts from Lv ${magCfg.pbLevel}`;
    this.char.data.photonBlast = id;
    this.autosave();
    sfx('jingle.magEvolve');
    this.notify(`Photon blast: ${PHOTON_BLASTS[id].name}`, 'good');
    return null;
  }

  /** Slot a learned unit into the Mag. */
  unitInsert(kind: UnitKind): string | null {
    const err = this.char.insertUnit(kind);
    if (err) return err;
    sfx('ui.equip', { pitch: 1.1 });
    this.autosave();
    return null;
  }

  /** Take a unit out of the Mag. */
  unitRemove(index: number): string | null {
    const err = this.char.removeUnit(index);
    if (err) return err;
    sfx('ui.equip', { pitch: 0.9 });
    this.autosave();
    return null;
  }

  /** Switch exactly these units on (the Damage tab's picks). */
  unitSet(kinds: UnitKind[]): string | null {
    const err = this.char.setActiveUnits(kinds);
    if (err) return err;
    sfx('ui.equip', { pitch: 1.1 });
    this.autosave();
    return null;
  }

  /** Sell every bag item the verdict calls junk: gear worse than what is worn, units already learned (uniques stay). */
  sellJunk(): string | null {
    const ch = this.char;
    const foe = this.damageFoe();
    const junk = ch.data.inventory.filter((it) => !ch.isEquipped(it.uid) && rarityOf(it) !== 'unique' && dropVerdict(ch, it, foe).look === 'junk');
    if (!junk.length) return 'Nothing to sell: no gear in the bag is worse than what you wear';
    let total = 0;
    for (const it of junk) {
      total += sellPrice(it);
      ch.removeItem(it.uid, Infinity);
    }
    ch.data.meseta += total;
    sfx('ui.sell');
    this.autosave();
    this.notify(`Sold ${junk.length} item${junk.length > 1 ? 's' : ''} for ${total.toLocaleString()} M.`, 'good');
    return null;
  }

  /**
   * Salvage the bag's junk magic and rare gear (worse than what is worn; uniques stay) into Photon Drops: a rare
   * always gives one, a magic item sometimes. Normal items are left to sell. Stops when the Photon Drop stack is full.
   */
  salvageJunk(): string | null {
    const ch = this.char;
    const foe = this.damageFoe();
    const junk = ch.data.inventory.filter((it) => {
      const r = rarityOf(it);
      return (r === 'magic' || r === 'rare') && !ch.isEquipped(it.uid) && dropVerdict(ch, it, foe).look === 'junk';
    });
    if (!junk.length) return 'Nothing to salvage: no magic or rare gear in the bag is worse than what you wear';
    let items = 0;
    let got = 0;
    for (const it of junk) {
      const n = salvageYield(it, this.rng);
      if (n && !ch.canAdd(makeItem('photon_drop', { qty: n }))) break;
      ch.removeItem(it.uid, Infinity);
      if (n) ch.addItem(makeItem('photon_drop', { qty: n }));
      items++;
      got += n;
    }
    if (!items) return 'Your Photon Drop stack is full';
    sfx('ui.sell');
    this.autosave();
    this.notify(`Salvaged ${items} item${items > 1 ? 's' : ''}: ${got ? `${got} Photon Drop${got > 1 ? 's' : ''}` : 'nothing came of it'}.${items < junk.length ? ' (The Photon Drop stack is full.)' : ''}`, got ? 'good' : '');
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

  /** Use a photon on a weapon or armour piece; `key` is its pick (an affix or an offer). */
  craftItem(targetUid: string, toolUid: string, key: string): string | null {
    const tool = this.char.find(toolUid);
    if (!tool) return 'Missing item';
    const r = craftWith(this.char, targetUid, toolUid, key, this.rng);
    if (!r.ok) return r.reason;
    sfx('ui.equip', { pitch: 1.35 });
    this.notify(`${itemName(this.char.find(targetUid)!)}: ${r.text}`, 'good');
    this.autosave();
    return null;
  }

  buy(proto: ItemInstance): string | null {
    const price = buyPrice(proto);
    if (this.char.data.meseta < price) return 'Not enough Meseta';
    const inst = shopCopy(proto);
    if (!this.char.addItem(inst)) return 'Inventory full (or stack limit reached)';
    this.char.data.meseta -= price;
    sfx('ui.buy');
    this.autosave();
    return null;
  }

  damageFoe(): Foe {
    // In a rift (or back in the city from one), against the rift's mix of every expedition. Once rifts are open a
    // Hell session judges gear against them from the start too: a fresh login used to measure against the Hell
    // Forest, whose numbers aren't a rift's (2026-10-11).
    if (this.run.rift) return riftFoe(this.run.rift);
    if (this.hell && riftsOpen(this.char.data) && expeditionOf(this.world?.areaId ?? 'city') === null) {
      return riftFoe({ tier: riftSave(this.char.data).tier, mods: [] });
    }
    return expeditionFoe(this.run.expedition, this.diff);
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
    const chips = e.affixes.map((a) => ({ name: AFFIXES[a].name, color: `#${AFFIXES[a].color.toString(16).padStart(6, '0')}` }));
    // Corrupting, shown first like an affix: enemies whose attacks corrupt, and every enemy in the Ruins and on Hell.
    const corrupts = e.arch.strikeStatus === 'corrupt' || e.arch.shotStatus === 'corrupt' || ((this.run.hell || this.run.expedition === 'ruins') && e.arch.ai !== 'node');
    if (corrupts) chips.unshift({ name: 'Corrupting', color: `#${CORRUPT_COLOR.toString(16).padStart(6, '0')}` });
    return chips;
  }

  /** The target's crowd-control resistances for its frame: the kinds it has, percent (100: immune). */
  private ccChips(t: Hittable): { kind: CcKind; pct: number }[] {
    if (!t.ccResist) return [];
    return CC_KINDS.map((kind) => ({ kind, pct: Math.round(t.ccResist!(kind)) })).filter((c) => c.pct > 0);
  }

  private hudState(): HudState {
    const p = this.player;
    const ch = this.char;
    // The Art bar: LMB the basic chain, then RMB / Q / E / R.
    const weaponKindId = ch.weaponInstance() ? ch.weaponKind().kind : 'none';
    const basicLabel = 'Basic chain: photon bolts, refills TP';
    const next = p.combo.phase === 'idle' ? 0 : p.combo.hitIndex + 1;
    const artView = (slot: number): PaletteSlotView => {
      const key = ART_KEY_LABELS[slot];
      const id = ch.artInSlot(slot);
      if (!id) return { key, label: 'Empty (Menu → Arts)', icon: '', kind: 'empty' };
      const a = ARTS[id];
      const cost = this.combat.artCost(id, Math.min(2, next));
      const label = `${a.name} — ${cost} TP: ${a.desc}`;
      const restores = id === 'resta' ? 'hp' : undefined;
      const outOfRange = this.combat.artAimBlocked(id) === 'Out of range';
      return { key, label, icon: techIcon(id), count: String(cost), kind: 'art', disabled: p.tp < cost, outOfRange, restores };
    };
    const palette: PaletteSlotView[] = [
      { key: 'LMB', label: basicLabel, icon: weaponIcon(weaponKindId), kind: 'basic' },
      artView(0),
      artView(1),
      artView(2),
      artView(3),
    ];

    const world = this.world!;
    const boss = world.boss;
    // The frame is the camera's target's, shown exactly while it is the target (no lingering after a hit since 2026-10-16).
    const shown = this.camTarget?.alive ? this.camTarget : null;

    let prompt: string | null = null;
    if (p.alive && !this.menus.isOpen) {
      const pk = this.nearestPickup();
      const it = this.nearestInteractable();
      if (pk) {
        const v = pk.verdict;
        // Same marks as the inventory; a requirement you don't meet yet is amber, not red.
        const mark = v?.mark === 'no' && v.look !== 'junk' ? 'locked' : v?.mark;
        const note = v?.note ? `<div class="pk-note ${mark}">${DROP_MARK[v.mark]} ${v.note}</div>` : '';
        // What photons could make of it: green if that beats what is worn.
        const craft = v?.crafted ? `<div class="pk-note ${v.crafted.up ? 'up' : 'dim'}">◆ ${v.crafted.text}</div>` : '';
        prompt = `<b>[Space]</b> Pick up ${pk.label}${note}${craft}`;
      } else if (it) {
        const talk = isCounter(it.kind);
        const sw = it.kind === 'switch' || it.kind === 'power';
        const verb = talk ? 'Talk' : it.kind === 'switch' ? (it.active ? '' : 'Press') : sw ? 'Pull' : 'Use';
        if (it.kind === 'pylon') prompt = `<b>[Space]</b> ${it.label}`;
        else if (verb) prompt = `<b>[Space]</b> ${verb}: ${it.label}`;
      } else if (this.nearestBox()) {
        prompt = `<b>[Space]</b> Break box`;
      }
    }

    const buffs: string[] = [];
    if (p.buffs.tech.t > 0) buffs.push(`▲TECH ${Math.ceil(p.buffs.tech.t)}s`);
    if (p.buffs.def.t > 0) buffs.push(`▲DEF ${Math.ceil(p.buffs.def.t)}s`);
    const statuses: { label: string; cls: string }[] = [];
    if (p.corruption > 0) statuses.push({ label: `CORRUPT ×${p.corruption} · ${p.inLight ? 'LIGHT' : p.corruptTimer > 0 ? `${Math.ceil(p.corruptTimer)}s` : 'FADING'}`, cls: 'corrupt' });
    if (p.burnStacks > 0) statuses.push({ label: `BURN ×${p.burnStacks}${p.moving ? '' : ' · MOVE'}`, cls: 'burn' });
    if (p.poison > 0) statuses.push({ label: `POISON ${Math.ceil(p.poison)}s`, cls: 'poison' });
    if (p.paralysis > 0) statuses.push({ label: `PARALYSIS ${p.paralysis.toFixed(1)}s`, cls: 'para' });
    else if (p.paraImmune > 0) statuses.push({ label: `PARA WARD ${Math.ceil(p.paraImmune)}s`, cls: 'ward' });

    const c = p.combo;
    const inj = ch.injector();
    const st = inj && injectorStats(inj, ch);
    const injector = inj && st ? { kind: st.kind, doses: st.doses, charge: chargeOf(inj, ch), name: itemName(inj), mod: st.mod ? INJECTOR_MODS[st.mod].name : null } : null;
    if (p.brace > 0) buffs.push(`▼DMG ${Math.ceil(p.brace)}s`);
    if (p.clarity > 0) buffs.push(`FREE CAST ${Math.ceil(p.clarity)}s`);
    if (p.shield > 0) buffs.push(`◆SHIELD ${Math.ceil(p.shield)}`);
    if (p.slipstream > 0) buffs.push(`★PERFECT ${Math.ceil(p.slipstream)}s`);
    const dr = p.damageTakenMult();
    if (dr < 1) buffs.push(`▼DMG ${Math.round((1 - dr) * 100)}%`);
    if (p.composureT > 0) buffs.push('◇COMPOSURE');
    if (p.rushT > 0) buffs.push(`»RUSH ${Math.ceil(p.rushT)}s`);
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
      comboHits: c.phase === 'swing' ? c.hitIndex + 1 : 0,
      comboStreak: c.phase === 'swing' ? c.streak : 0,
      comboWindow: c.inWindow,
      comboBroken: c.phase === 'swing' && c.broken && !c.sealed,
      target: shown
        ? {
            ref: shown,
            name: shown.name,
            hp: shown.hp,
            maxHp: shown.maxHp,
            statuses: shown.statusTimers?.() ?? [],
            affixes: shown instanceof Enemy ? this.affixChips(shown) : [],
            champion: shown instanceof Enemy && shown.champion,
            cc: this.ccChips(shown),
          }
        : null,
      boss:
        boss && boss.engaged && (boss.alive || boss.deadT < 3)
          ? {
              ref: boss,
              // In a rift, its tier after the name.
              name: boss.name + (this.run.rift ? ` · Tier ${this.run.rift.tier}` : '') + (boss.alive ? (boss.hudNote ?? '') : ''),
              hp: boss.hp,
              maxHp: boss.maxHp,
              weak: boss.weakPointOpen,
              immune: CC_KINDS.filter((k) => boss.ccResist(k) >= 100),
              statuses: boss.statusTimers(),
            }
          : null,
      area: world.def.name + (this.run.rift && world.def.kind !== 'city' ? '' : difficultyTag(this.diff)),
      roomInfo: this.holdInfo() ?? this.roomInfo,
      prompt,
      buffs,
      statuses,
      cast: p.castProgress,
      cc:
        p.paralysis > 0
          ? {
              label: 'PARALYSED',
              left: p.paralysis,
              total: Math.max(p.paralysis, p.paralysisTotal),
              // A Sol injector is the way out (usable while paralysed).
              hint: st?.mod === 'sol' && st.doses >= 1 ? 'Press 1: Sol breaks it' : null,
            }
          : null,
      injector,
      dash: { charges: p.dashCharges, max: p.maxDashCharges, refill: p.dashRefill },
      photonBlast: this.photonBlastName() ? { name: this.photonBlastName()!, charge: p.pb } : null,
    };
  }
}
