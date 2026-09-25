import { ConflictException } from '@nestjs/common';
import { AUTH_ERRORS } from '../common/error-codes';

describe('서버 오류 코드 계약', () => {
  it('예외 응답 본문이 { code, message }로 나간다 — 클라이언트가 코드로 문구를 고른다', () => {
    const e = new ConflictException(AUTH_ERRORS.EMAIL_TAKEN);
    expect(e.getResponse()).toEqual({
      code: 'AUTH_EMAIL_TAKEN',
      message: '이미 사용 중인 이메일입니다.',
    });
    // 기존 message 기반 소비자(로그·구버전 클라이언트)도 그대로 읽는다
    expect(e.message).toBe('이미 사용 중인 이메일입니다.');
  });

  it('코드는 전부 AUTH_ 접두 + 유일하다', () => {
    const codes = Object.values(AUTH_ERRORS).map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c.startsWith('AUTH_'))).toBe(true);
  });
});
