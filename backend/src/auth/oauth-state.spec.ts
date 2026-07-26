import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { verifyOAuthState } from './oauth-state';

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
