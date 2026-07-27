import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readLinkCode, verifyOAuthState } from './oauth-state';

function mockReq(cookieState?: string, queryState?: string): Request {
  return {
    cookies: cookieState ? { oauth_state_kakao: cookieState } : {},
    query: queryState ? { state: queryState } : {},
  } as unknown as Request;
}

function mockRes(): Response & { clearCookie: jest.Mock } {
  return { clearCookie: jest.fn() } as unknown as Response & {
    clearCookie: jest.Mock;
  };
}

describe('verifyOAuthState (CSRF)', () => {
  it('쿠키 state와 쿼리 state가 일치하면 통과하고 쿠키를 지운다', () => {
    const res = mockRes();
    expect(() =>
      verifyOAuthState(mockReq('abc', 'abc'), res, 'kakao'),
    ).not.toThrow();
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state_kakao', {
      path: '/',
    });
  });

  it('state가 다르면 401 (CSRF 차단)', () => {
    expect(() =>
      verifyOAuthState(mockReq('abc', 'evil'), mockRes(), 'kakao'),
    ).toThrow(UnauthorizedException);
  });

  it('쿠키가 없으면(플로우 미시작) 401', () => {
    expect(() =>
      verifyOAuthState(mockReq(undefined, 'abc'), mockRes(), 'kakao'),
    ).toThrow(UnauthorizedException);
  });

  it('쿼리 state가 없으면 401', () => {
    expect(() =>
      verifyOAuthState(mockReq('abc', undefined), mockRes(), 'kakao'),
    ).toThrow(UnauthorizedException);
  });

  it('실패해도 쿠키는 지운다(재사용 방지)', () => {
    const res = mockRes();
    expect(() =>
      verifyOAuthState(mockReq('abc', 'evil'), res, 'kakao'),
    ).toThrow();
    expect(res.clearCookie).toHaveBeenCalled();
  });
});

describe('readLinkCode (수동 연결 분기)', () => {
  it('link 쿠키가 있으면 code를 반환하고 쿠키를 지운다(연결 모드)', () => {
    const res = mockRes();
    const req = {
      cookies: { oauth_link_google: 'code-123' },
    } as unknown as Request;

    expect(readLinkCode(req, res, 'google')).toBe('code-123');
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_link_google', {
      path: '/',
    });
  });

  it('link 쿠키가 없으면 null(일반 로그인 모드)', () => {
    const res = mockRes();
    const req = { cookies: {} } as unknown as Request;

    expect(readLinkCode(req, res, 'kakao')).toBeNull();
    // 있든 없든 정리는 시도한다(1회용).
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_link_kakao', {
      path: '/',
    });
  });

  it('link 쿠키가 빈 문자열이면 null(연결 모드로 오인 안 함)', () => {
    const res = mockRes();
    const req = { cookies: { oauth_link_kakao: '' } } as unknown as Request;

    expect(readLinkCode(req, res, 'kakao')).toBeNull();
  });
});
