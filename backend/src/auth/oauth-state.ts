import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';

/**
 * 소셜 로그인 CSRF 방어(state).
 *
 * OAuth 콜백이 "로그인을 시작한 그 브라우저"에서 온 것인지 확인해야 한다.
 * 그러지 않으면 공격자가 자신의 인가 코드로 피해자를 로그인시키는 login CSRF가
 * 가능하다. 세션 저장소 없이, state를 httpOnly 쿠키에 담아 콜백의 state와
 * 대조한다(stateless). 쿠키는 httpOnly라 공격자 페이지에서 못 읽고 못 세팅한다.
 */

const STATE_TTL_MS = 5 * 60 * 1000; // 인가 페이지 체류 여유

function stateCookieName(provider: string): string {
  return `oauth_state_${provider}`;
}

function linkCookieName(provider: string): string {
  return `oauth_link_${provider}`;
}

/**
 * 인가 시작용 가드 팩토리. passport 인가 URL에 state를 실어 보내고, 같은 값을
 * httpOnly 쿠키로 심는다. 콜백에서 verifyOAuthState로 대조한다.
 */
export function SocialInitiateGuard(provider: string): Type<CanActivate> {
  @Injectable()
  class Guard extends AuthGuard(provider) {
    // passport authenticate()에 넘길 옵션. state를 여기서 주입한다.
    getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
      const res = context.switchToHttp().getResponse<Response>();
      const state = randomBytes(16).toString('hex');
      res.cookie(stateCookieName(provider), state, {
        httpOnly: true,
        sameSite: 'lax', // 카카오/구글 리다이렉트(top-level GET)에 쿠키가 실려야 함
        secure: process.env.NODE_ENV === 'production',
        maxAge: STATE_TTL_MS,
        path: '/',
      });
      return { state };
    }
  }
  return Guard;
}

/**
 * 소셜 계정 "수동 연결" 시작용 가드(계정 병합 2단계).
 *
 * 로그인 상태에서 발급한 1회용 link code(?code=)를 httpOnly 쿠키로 옮겨 콜백까지
 * 나른다(브라우저 top-level 이동이라 Authorization 헤더가 없어, 쿠키로 유저 의도를
 * 전달한다). 동시에 로그인과 같은 CSRF state 쿠키도 심는다. 코드의 실제 소비(1회)는
 * 콜백에서 authService.redeemLinkCode가 한다 — 그래야 코드를 재사용/위조로부터 막고,
 * 로그인/연결을 같은 콜백 URL로 공유할 수 있다.
 *
 * code는 랜덤 UUID·단명·1회용이라, 유출돼도 가치가 낮다(콜백이 먼저 소비하면 무효).
 */
export function LinkInitiateGuard(provider: string): Type<CanActivate> {
  @Injectable()
  class Guard extends AuthGuard(provider) {
    getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
      const req = context.switchToHttp().getRequest<Request>();
      const res = context.switchToHttp().getResponse<Response>();

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      // link code를 콜백까지 나를 httpOnly 쿠키. 콜백이 존재를 보고 "연결 모드"로 분기.
      res.cookie(linkCookieName(provider), code, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: STATE_TTL_MS,
        path: '/',
      });

      const state = randomBytes(16).toString('hex');
      res.cookie(stateCookieName(provider), state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: STATE_TTL_MS,
        path: '/',
      });
      return { state };
    }
  }
  return Guard;
}

/**
 * 콜백에서 link 쿠키를 읽고 즉시 지운다(1회용). 값이 있으면 "연결 모드"의 link code,
 * 없으면 일반 로그인. 실제 code 소비(userId 매핑)는 호출부가 redeemLinkCode로 한다.
 */
export function readLinkCode(
  req: Request,
  res: Response,
  provider: string,
): string | null {
  const name = linkCookieName(provider);
  const code = (req.cookies as Record<string, string> | undefined)?.[name];
  res.clearCookie(name, { path: '/' });
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * 콜백에서 state 대조. 쿼리의 state와 쿠키의 state가 일치해야 한다.
 * 불일치/부재면 401. 검증 후 쿠키를 지운다(1회용).
 */
export function verifyOAuthState(
  req: Request,
  res: Response,
  provider: string,
): void {
  const cookieName = stateCookieName(provider);
  const cookieState = (req.cookies as Record<string, string> | undefined)?.[
    cookieName
  ];
  const queryState =
    typeof req.query.state === 'string' ? req.query.state : undefined;

  // 사용 후 즉시 폐기(성공/실패 무관).
  res.clearCookie(cookieName, { path: '/' });

  if (!cookieState || !queryState || cookieState !== queryState) {
    throw new UnauthorizedException('잘못된 로그인 요청입니다(state 불일치).');
  }
}
