// quizError.ts — API 에러 → 환자 친화 메시지 매핑 테스트
//
// 검증 포인트 (Plan §1, §10):
//  - 410/409/422/403/404 상태코드별 고정 안내문 + 플래그
//  - 상태코드 없을 때 서버 message → Error.message → 기본 문구 순

import { describe, expect, it } from 'vitest';
import { toQuizErrorInfo } from './quizError.js';

/** axios 스타일 에러 객체를 만든다 */
function makeAxiosError(status: number, serverMessage?: string): unknown {
  return {
    response: {
      status,
      data: serverMessage !== undefined ? { message: serverMessage } : {},
    },
  };
}

describe('toQuizErrorInfo', () => {
  describe('상태코드별 매핑', () => {
    it('410이면 세션 만료 메시지와 isSessionExpired=true여야 한다', () => {
      const info = toQuizErrorInfo(makeAxiosError(410));
      expect(info.status).toBe(410);
      expect(info.isSessionExpired).toBe(true);
      expect(info.isNotReady).toBe(false);
      expect(info.message).toBe('시간이 초과됐어요. 다시 시작할까요?');
    });

    it('409이면 준비 중 메시지와 isNotReady=true여야 한다', () => {
      const info = toQuizErrorInfo(makeAxiosError(409));
      expect(info.status).toBe(409);
      expect(info.isNotReady).toBe(true);
      expect(info.isSessionExpired).toBe(false);
      expect(info.message).toBe('아직 준비 중이에요. 잠시 후 다시 시도해주세요.');
    });

    it('422이면 답안 형식 메시지여야 한다', () => {
      const info = toQuizErrorInfo(makeAxiosError(422));
      expect(info.status).toBe(422);
      expect(info.message).toBe('답안 형식을 다시 확인해주세요.');
      expect(info.isSessionExpired).toBe(false);
      expect(info.isNotReady).toBe(false);
    });

    it('403이면 접근 불가 메시지여야 한다', () => {
      const info = toQuizErrorInfo(makeAxiosError(403));
      expect(info.status).toBe(403);
      expect(info.message).toBe('이 퀴즈에 접근할 수 없어요.');
    });

    it('404이면 찾을 수 없음 메시지여야 한다', () => {
      const info = toQuizErrorInfo(makeAxiosError(404));
      expect(info.status).toBe(404);
      expect(info.message).toBe('퀴즈를 찾을 수 없어요.');
    });
  });

  describe('상태코드별 고정 문구가 서버 message보다 우선', () => {
    it('410이면 서버 message가 있어도 고정 안내문을 쓴다', () => {
      const info = toQuizErrorInfo(makeAxiosError(410, '커스텀 서버 메시지'));
      expect(info.message).toBe('시간이 초과됐어요. 다시 시작할까요?');
    });
  });

  describe('상태코드가 없는 경우', () => {
    it('서버 message가 있으면 그것을 사용한다 (status=500은 매핑 외)', () => {
      const info = toQuizErrorInfo(makeAxiosError(500, '서버 내부 오류'));
      expect(info.status).toBe(500);
      expect(info.message).toBe('서버 내부 오류');
    });

    it('response가 없는 Error 객체면 Error.message를 사용한다', () => {
      const info = toQuizErrorInfo(new Error('네트워크 끊김'));
      expect(info.status).toBeNull();
      expect(info.message).toBe('네트워크 끊김');
    });

    it('정보가 전혀 없으면 기본 문구를 사용한다', () => {
      const info = toQuizErrorInfo(null);
      expect(info.status).toBeNull();
      expect(info.message).toBe('잠시 문제가 생겼어요. 다시 시도해주세요.');
      expect(info.isSessionExpired).toBe(false);
      expect(info.isNotReady).toBe(false);
    });

    it('빈 메시지 Error는 기본 문구로 폴백한다', () => {
      const info = toQuizErrorInfo(new Error(''));
      expect(info.message).toBe('잠시 문제가 생겼어요. 다시 시도해주세요.');
    });
  });
});
