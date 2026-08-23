import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSoundCheck,
  isSoundCheckedToday,
  markSoundCheckedToday,
} from './soundCheck.js';

/**
 * 소리 확인 기록.
 *
 * 지키는 불변식은 둘이다.
 *  - **하루 지나면 다시 묻는다** — 기기·볼륨은 하루 사이에 바뀐다.
 *  - **저장이 막히면 묻는 쪽으로 기운다** — 한 번 더 묻는 값이 소리 없이
 *    검사를 치르는 값보다 싸다.
 */
describe('soundCheck', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('확인 전에는 통과가 아니다', () => {
    expect(isSoundCheckedToday()).toBe(false);
  });

  it('통과를 적으면 같은 날에는 다시 묻지 않는다', () => {
    const day = new Date(2026, 7, 23, 9, 0);
    markSoundCheckedToday(day);
    expect(isSoundCheckedToday(new Date(2026, 7, 23, 22, 30))).toBe(true);
  });

  it('날이 바뀌면 다시 묻는다', () => {
    markSoundCheckedToday(new Date(2026, 7, 23));
    expect(isSoundCheckedToday(new Date(2026, 7, 24))).toBe(false);
  });

  it('자정을 넘겨도 UTC 변환으로 날짜가 밀리지 않는다', () => {
    // KST 오전 8시는 UTC로는 전날 23시다. UTC 기준으로 적으면 하루 밀린다.
    const morning = new Date(2026, 7, 23, 8, 0);
    markSoundCheckedToday(morning);
    expect(isSoundCheckedToday(morning)).toBe(true);
  });

  it('기록을 지우면 다시 묻는다', () => {
    markSoundCheckedToday();
    clearSoundCheck();
    expect(isSoundCheckedToday()).toBe(false);
  });

  it('localStorage를 못 쓰면 묻는 쪽으로 기운다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('사파리 비공개 모드');
    });
    expect(isSoundCheckedToday()).toBe(false);
  });

  it('저장이 막혀도 예외를 밖으로 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('용량 초과');
    });
    expect(() => markSoundCheckedToday()).not.toThrow();
  });
});
