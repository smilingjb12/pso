import * as THREE from 'three';
import type { WeaponKind } from '../data/items';
import type { CharacterModel } from './heroine';

// Two-handed weapon holds. After the rig has posed the body, arm IK places the hands on
// the weapon: the left hand always grips the handle a little below the right one, and
// swing styles driven by blade keyframes (see swings.ts) also place the right hand.
// Each arm is a two-bone chain (shoulder -> elbow -> wrist) solved analytically; the
// wrist turns so the handle runs through the fist the same way it does for the right hand.

/**
 * Where the left hand holds each melee weapon, in metres along the weapon from the right
 * hand's grip (negative = toward the pommel). Staves are held with the hands apart; the
 * partisan's left hand sits forward on the shaft; the dagger's covers the pommel.
 */
export const LEFT_HAND_AT: Partial<Record<WeaponKind, number>> = {
  saber: -0.085,
  sword: -0.1,
  dagger: -0.07,
  partisan: 0.4,
  cane: -0.24,
  rod: -0.28,
  wand: -0.1,
};

/** Hilt target for a keyframed swing, in the character's own space (feet at the origin, +Z ahead, +X her left). */
export interface HiltTarget {
  /** Right-hand grip point. */
  at: THREE.Vector3;
  /** Unit vector along the blade, from the grip toward the tip. */
  dir: THREE.Vector3;
}

const _S = new THREE.Vector3();
const _W = new THREE.Vector3();
const _E = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _qc = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _gripAxis = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * World rotation of a hand whose grip axis (hand space `gripAxis`) points along `axis`
 * while the hand itself stays as close as possible to the forearm direction `fore`.
 */
function handRotation(axis: THREE.Vector3, fore: THREE.Vector3, gripAxis: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  // Hand space: e1 = grip axis, e2 = the hand's length (-Y) made perpendicular to it.
  _e1.copy(gripAxis);
  _e2.set(0, -1, 0).addScaledVector(_e1, _e1.y).normalize(); // (0,-1,0) - ((0,-1,0)·e1) e1
  _e3.crossVectors(_e1, _e2);
  _m1.makeBasis(_e1, _e2, _e3);
  // World: same pair built from the weapon axis and the forearm.
  _x.copy(axis);
  _y.copy(fore).addScaledVector(axis, -fore.dot(axis));
  if (_y.lengthSq() < 1e-6) _y.set(0, -1, 0).addScaledVector(axis, axis.y);
  _y.normalize();
  _z.crossVectors(_x, _y);
  _m2.makeBasis(_x, _y, _z);
  _m1.transpose();
  _m2.multiply(_m1);
  return out.setFromRotationMatrix(_m2);
}

/**
 * Pose one arm so its hand's grip point lands on `target` with the grip axis along `axis`
 * (both in world space), blending from the current pose by `weight`. `pole` (world) is the
 * direction the elbow should point. Returns how stretched the arm is (1 = fully straight).
 */
function reachArm(model: CharacterModel, side: 'L' | 'R', target: THREE.Vector3, axis: THREE.Vector3, pole: THREE.Vector3, weight: number): number {
  const j = model.rig.joints;
  const sh = side === 'L' ? j.shoulderL : j.shoulderR;
  const el = side === 'L' ? j.elbowL : j.elbowR;
  const hand = side === 'L' ? j.handL : j.handR;
  const chest = sh.parent!;
  const a = el.position.length();
  const b = hand.position.length();
  const gp = model.grip.position;
  _gripAxis.set(0, 0, 1).applyQuaternion(model.grip.quaternion);

  chest.updateWorldMatrix(true, false);
  chest.getWorldQuaternion(_qc);
  _S.copy(sh.position).applyMatrix4(chest.matrixWorld);

  // The wrist target depends on the hand's turn, which depends on the forearm: two passes settle it.
  _f.copy(target).sub(_S).normalize();
  let stretch = 0;
  for (let pass = 0; pass < 2; pass++) {
    handRotation(axis, _f, _gripAxis, _qh);
    _W.copy(gp).applyQuaternion(_qh).negate().add(target);
    let d = _W.distanceTo(_S);
    stretch = d / (a + b);
    d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    _n.copy(_W).sub(_S).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    _p.copy(pole).addScaledVector(_n, -pole.dot(_n));
    if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0).addScaledVector(_n, _n.y);
    _p.normalize();
    _E.copy(_S).addScaledVector(_n, a * cosA).addScaledVector(_p, a * Math.sqrt(1 - cosA * cosA));
    // Wrist as actually reached (on the clamped line), then the forearm direction.
    _t.copy(_S).addScaledVector(_n, d);
    _f.copy(_t).sub(_E).normalize();
  }

  // Upper arm: local -Y runs shoulder -> elbow, and the elbow hinge (local X) bends the forearm toward +Z.
  _y.copy(_S).sub(_E).normalize();
  _z.copy(_f).addScaledVector(_y, -_f.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.copy(_p);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m2.makeBasis(_x, _y, _z);
  _qs.setFromRotationMatrix(_m2);
  const bend = Math.acos(THREE.MathUtils.clamp(-_y.dot(_f), -1, 1));
  _qe.setFromAxisAngle(X_AXIS, -bend);

  // Back to joint-local rotations, blended with the pose the rig gave.
  _q.copy(_qc).invert().multiply(_qs);
  sh.quaternion.slerp(_q, weight);
  el.quaternion.slerp(_qe, weight);
  _q.copy(_qs).multiply(_qe).invert().multiply(_qh);
  hand.quaternion.slerp(_q, weight);
  sh.updateWorldMatrix(false, true);
  return stretch;
}

const _target = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _gq = new THREE.Quaternion();

/** Elbow directions in the chest's frame: down, out to that side and a little back. */
function poleFor(model: CharacterModel, side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
  const chest = model.rig.joints.chest;
  chest.getWorldQuaternion(_gq);
  return out.set(side === 'L' ? 0.7 : -0.7, -1, -0.45).normalize().applyQuaternion(_gq);
}

/** Arm stretch from the last holdTwoHanded call, per arm (for the Swing Lab). */
export const holdStats = { right: 0, left: 0 };

/** How straight the left arm would be with its hand on the handle at `at` (1 = fully straight). */
function leftStretchAt(model: CharacterModel, at: number): number {
  const j = model.rig.joints;
  _target.set(0, 0, at).applyMatrix4(model.grip.matrixWorld);
  _S.copy(j.shoulderL.position).applyMatrix4(j.chest.matrixWorld);
  _f.copy(_target).sub(_S).normalize();
  _gripAxis.set(0, 0, 1).applyQuaternion(model.grip.quaternion);
  handRotation(_axis, _f, _gripAxis, _qh);
  _W.copy(model.grip.position).applyQuaternion(_qh).negate().add(_target);
  return _W.distanceTo(_S) / (j.elbowL.position.length() + j.handL.position.length());
}

/**
 * Hold the weapon with both hands. With `hilt`, the right hand is first moved to that grip
 * point and blade direction (character space); either way the left hand then takes the
 * handle `leftAt` metres along the blade from the right hand. Returns the larger arm stretch
 * (above ~0.99 the hand can't quite reach).
 */
export function holdTwoHanded(model: CharacterModel, weight: number, leftAt: number, hilt?: HiltTarget): number {
  if (weight <= 0.001) return 0;
  let stretch = 0;
  const root = model.rig.root;
  root.updateWorldMatrix(true, false);
  if (hilt) {
    _target.copy(hilt.at).applyMatrix4(root.matrixWorld);
    root.getWorldQuaternion(_gq);
    _axis.copy(hilt.dir).applyQuaternion(_gq).normalize();
    stretch = reachArm(model, 'R', _target, _axis, poleFor(model, 'R', _pole), weight);
  }
  holdStats.right = stretch;
  // Left hand onto the handle, wherever the right hand (and so the weapon) now is. On a long
  // shaft it slides up toward the right hand when its usual spot is out of reach.
  model.grip.updateWorldMatrix(true, false);
  model.rig.joints.chest.updateWorldMatrix(true, false);
  model.grip.getWorldQuaternion(_gq);
  _axis.set(0, 0, 1).applyQuaternion(_gq);
  const nearest = Math.sign(leftAt) * Math.min(Math.abs(leftAt), 0.085);
  let at = leftAt;
  for (let i = 0; i <= 8; i++) {
    at = leftAt + ((nearest - leftAt) * i) / 8;
    if (leftStretchAt(model, at) <= 0.97) break;
  }
  _target.set(0, 0, at).applyMatrix4(model.grip.matrixWorld);
  holdStats.left = reachArm(model, 'L', _target, _axis, poleFor(model, 'L', _pole), weight);
  return Math.max(stretch, holdStats.left);
}
