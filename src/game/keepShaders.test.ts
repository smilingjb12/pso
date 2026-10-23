import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { keepShaders } from './keepShaders';

describe('keepShaders', () => {
  const renderer = (programs: { type: string; usedTimes: number }[]) => ({ info: { programs } }) as unknown as THREE.WebGLRenderer;

  it('keeps each built-in program with one extra use, once, so disposing its last material leaves it compiled', () => {
    const basic = { type: 'MeshBasicMaterial', usedTimes: 1 };
    const points = { type: 'PointsMaterial', usedTimes: 2 };
    const r = renderer([basic, points]);
    keepShaders(r);
    keepShaders(r);
    expect([basic.usedTimes, points.usedTimes]).toEqual([2, 3]);
  });

  it('leaves ShaderMaterial programs to be released (their keys change once released)', () => {
    const shader = { type: 'ShaderMaterial', usedTimes: 1 };
    const raw = { type: 'RawShaderMaterial', usedTimes: 1 };
    keepShaders(renderer([shader, raw]));
    expect([shader.usedTimes, raw.usedTimes]).toEqual([1, 1]);
  });
});
