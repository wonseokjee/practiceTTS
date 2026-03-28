import { describe, it, expect } from 'vitest';
import { createLocTrial } from './LocTrial.js';

const BASE_AUDIO_END = 1000;

describe('createLocTrial - 불변 조건 검증', () => {
  it('audioEndTime = 0 이면 에러를 던진다', () => {
    expect(() =>
      createLocTrial({ trialNumber: 1, audioEndTime: 0, touchTime: null, touchInBounds: false }),
    ).toThrow();
  });

  it('audioEndTime이 음수이면 에러를 던진다', () => {
    expect(() =>
      createLocTrial({ trialNumber: 1, audioEndTime: -1, touchTime: null, touchInBounds: false }),
    ).toThrow();
  });

  it('touchTime이 audioEndTime보다 앞서면 에러를 던진다 (음수 latency)', () => {
    expect(() =>
      createLocTrial({
        trialNumber: 1,
        audioEndTime: BASE_AUDIO_END,
        touchTime: BASE_AUDIO_END - 1,
        touchInBounds: true,
      }),
    ).toThrow();
  });
});

describe('createLocTrial - 정상 생성', () => {
  it('touchTime이 null이면 latency도 null이고 score는 0이다', () => {
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime: null,
      touchInBounds: false,
    });
    expect(trial.latency).toBeNull();
    expect(trial.score).toBe(0);
  });

  it('latency = touchTime - audioEndTime 으로 계산된다', () => {
    const touchTime = BASE_AUDIO_END + 2_000;
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime,
      touchInBounds: true,
    });
    expect(trial.latency).toBe(2_000);
  });

  it('3000ms 이내 터치는 score = 3 (정상)', () => {
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime: BASE_AUDIO_END + 3_000,
      touchInBounds: true,
    });
    expect(trial.score).toBe(3);
  });

  it('touchInBounds = false 이면 latency가 있어도 score = 0', () => {
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime: BASE_AUDIO_END + 1_000,
      touchInBounds: false,
    });
    expect(trial.score).toBe(0);
  });
});

describe('createLocTrial - 불변성 (Object.freeze)', () => {
  it('생성된 객체에 직접 속성 할당 시 TypeError가 발생한다 (strict mode)', () => {
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime: null,
      touchInBounds: false,
    });
    expect(() => {
      (trial as { score: number }).score = 999;
    }).toThrow(TypeError);
  });

  it('Object.isFrozen 이 true 이다', () => {
    const trial = createLocTrial({
      trialNumber: 1,
      audioEndTime: BASE_AUDIO_END,
      touchTime: null,
      touchInBounds: false,
    });
    expect(Object.isFrozen(trial)).toBe(true);
  });
});
