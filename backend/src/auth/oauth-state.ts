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

/**
 * 연결/병합 "의도" 쿠키. 인증된 start 엔드포인트만 httpOnly로 심는다(브라우저 세션에
 * 결속). provider와 무관한 단일 이름 — 의도 코드는 provider를 담지 않는다.
 */
const INTENT_COOKIE = 'oauth_intent';

/**
 * 인증된 /auth/link|merge/start에서 호출: 1회용 의도 코드를 httpOnly 쿠키로 심는다.
 *
 * 왜 URL(?ticket=)이 아니라 쿠키인가(계정 연결 CSRF 방어): 코드를 URL로 받으면
 * 공격자가 자기 코드를 피해자에게 링크로 넘겨(`/auth/google/link?ticket=…`) 피해자의
 * 소셜 신원을 공격자 계정에 연결시킬 수 있다(연결 대상이 "이 브라우저의 로그인 유저"가
 * 아니라 "코드 소유자"라서). httpOnly 쿠키는 인증된 XHR 응답으로만 심기므로, 공격자가
 * 피해자 브라우저에 심을 수 없다 → 연결은 항상 "start를 호출한 그 세션"에 묶인다.
 */
export function setIntentCookie(res: Response, code: string): void {
  res.cookie(INTENT_COOKIE, code, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STATE_TTL_MS,
    path: '/',
  });
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
 * 소셜 계정 "수동 연결/병합" 시작용 가드(계정 병합 2·3단계).
 *
 * 브라우저 top-level 이동엔 Authorization 헤더가 없어, 유저 의도를 쿠키로 전달한다.
 * 의도 코드는 **인증된 start 엔드포인트가 심은 oauth_intent 쿠키**로만 받는다(URL
 * ?ticket= 폐기 — setIntentCookie 주석의 CSRF 사유 참고). 그 쿠키가 없으면(=이 세션이
 * start를 호출한 적 없음, 예: 공격자가 유도한 링크) 인가를 시작하지 않는다.
 *
 * 로그인과 같은 CSRF state 쿠키도 심는다. 의도 코드는 oauth_intent 그대로 콜백까지
 * 실려가고, 콜백이 readLinkCode로 1회 소비한다.
 */
export function LinkInitiateGuard(provider: string): Type<CanActivate> {
  @Injectable()
  class Guard extends AuthGuard(provider) {
    getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
      const req = context.switchToHttp().getRequest<Request>();
      const res = context.switchToHttp().getResponse<Response>();

      // 인증된 start가 심은 의도 쿠키가 있어야 한다. 없으면 이 브라우저 세션이 연결을
      // 시작한 게 아니다(계정 연결 CSRF 차단) → 인가 시작 거부.
      const intent = (req.cookies as Record<string, string> | undefined)?.[
        INTENT_COOKIE
      ];
      if (!intent) {
        throw new UnauthorizedException('잘못된 연결 요청입니다.');
      }

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
 * 콜백에서 의도 쿠키(oauth_intent)를 읽고 즉시 지운다(1회용). 값이 있으면 연결/병합
 * 모드의 코드, 없으면 일반 로그인. 실제 code 소비(userId·mode 매핑)는 호출부가
 * redeemLinkCode로 한다.
 */
export function readLinkCode(req: Request, res: Response): string | null {
  const code = (req.cookies as Record<string, string> | undefined)?.[
    INTENT_COOKIE
  ];
  res.clearCookie(INTENT_COOKIE, { path: '/' });
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
