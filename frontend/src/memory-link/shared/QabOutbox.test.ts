// QabOutbox — 재전송 대기열 단위 테스트
//
// 검증 포인트:
//  - enqueue는 저장만 한다(네트워크 호출 없음)
//  - flush는 순서대로 보내고, 보낸 것만 지운다
//  - 4xx는 그 항목만 버리고 계속, 5xx·네트워크는 거기서 멈춘다
//  - 동시에 flush를 두 번 부르면 하나로 합쳐진다
//  - 24시간 넘은 항목은 버리고 건수를 로그한다
//  - clear는 통째로 비운다

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QabResultInput } from '../patient/quiz/domain/QabResult.js';
import { clear, enqueue, flush, size } from './QabOutbox.js';

const item = (itemRef: string): QabResultInput => ({
  subtest: 'word',
  itemRef,
  isCorrect: true,
  answeredAt: '2026-09-13T00:00:00.000Z',
});

/** axios가 실제로 만드는 것과 같은 모양(isAxiosError 마커 + response.status). */
function axiosError(status: number): unknown {
  return { isAxiosError: true, response: { status } };
}

describe('QabOutbox', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('enqueue는 저장만 한다 — 넘긴 submit 함수를 부르지 않는다', () => {
    const submit = vi.fn();
    enqueue('tok-1', [item('a')]);
    expect(size()).toBe(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('flush는 큐를 순서대로 보내고 성공한 만큼 지운다', async () => {
    enqueue('tok-1', [item('a')], undefined, false);
    enqueue('tok-2', [item('b')], 3, true, { word: 2 });
    const submit = vi.fn().mockResolvedValue({ saved: 1 });

    await flush(submit);

    expect(submit).toHaveBeenNthCalledWith(
      1,
      'tok-1',
      [item('a')],
      undefined,
      false,
      undefined,
    );
    expect(submit).toHaveBeenNthCalledWith(
      2,
      'tok-2',
      [item('b')],
      3,
      true,
      { word: 2 },
    );
    expect(size()).toBe(0);
  });

  it('4xx는 그 항목만 버리고 다음으로 넘어간다 — 재시도해도 똑같이 실패할 요청', async () => {
    enqueue('bad', [item('a')]);
    enqueue('good', [item('b')]);
    const submit = vi
      .fn()
      .mockRejectedValueOnce(axiosError(400))
      .mockResolvedValueOnce({ saved: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await flush(submit);

    expect(submit).toHaveBeenCalledTimes(2);
    expect(size()).toBe(0); // 둘 다 큐에서 빠졌다(하나는 버려서, 하나는 성공해서)
    expect(warn).toHaveBeenCalled();
  });

  it('5xx·네트워크 오류는 거기서 멈춘다 — 실패한 항목과 그 뒤를 그대로 남긴다', async () => {
    enqueue('first', [item('a')]);
    enqueue('second', [item('b')]);
    const submit = vi
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce({ saved: 1 }); // 불려서는 안 된다

    await flush(submit);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(size()).toBe(2); // 아무것도 안 지워졌다
  });

  it('응답 없는 순수 네트워크 에러(axios 아님)도 멈춘다', async () => {
    enqueue('only', [item('a')]);
    const submit = vi.fn().mockRejectedValue(new Error('Network Error'));

    await flush(submit);

    expect(size()).toBe(1);
  });

  it('동시에 flush를 두 번 부르면 하나로 합쳐진다 — submit이 큐 길이만큼만 불린다', async () => {
    enqueue('tok-1', [item('a')]);
    let resolveFirst: (() => void) | undefined;
    const submit = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ saved: 1 });
        }),
    );

    const p1 = flush(submit);
    const p2 = flush(submit); // 이미 도는 flush에 합류 — 새 루프를 안 만든다
    resolveFirst?.();
    await Promise.all([p1, p2]);

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('24시간 넘은 항목은 버리고 건수를 로그한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    enqueue('stale', [item('a')]);

    vi.setSystemTime(new Date('2026-09-02T00:00:01.000Z')); // 24h + 1초 뒤
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enqueue('fresh', [item('b')]); // enqueue 시점에도 정리된다

    expect(size()).toBe(1); // stale만 사라졌다
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1건'));
    vi.useRealTimers();
  });

  it('clear는 통째로 비운다(로그아웃 경계, 2-2A)', () => {
    enqueue('tok-1', [item('a')]);
    enqueue('tok-2', [item('b')]);
    clear();
    expect(size()).toBe(0);
  });

  it('localStorage가 막혀 있어도(사생활 보호 모드 등) 죽지 않는다', () => {
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => enqueue('tok-1', [item('a')])).not.toThrow();

    localStorage.setItem = original;
  });
});
