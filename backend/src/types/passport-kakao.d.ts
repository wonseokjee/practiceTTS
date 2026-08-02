/**
 * passport-kakao 최소 타입 선언 (@types 미제공).
 * 우리가 실제로 쓰는 표면만 선언한다.
 */
declare module 'passport-kakao' {
  export interface KakaoProfile {
    id: number | string;
    username?: string;
    displayName?: string;
    _json?: {
      id?: number;
      kakao_account?: {
        email?: string;
        profile?: { nickname?: string };
      };
      properties?: { nickname?: string };
    };
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret?: string;
    callbackURL: string;
  }

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: KakaoProfile,
    done: (error: unknown, user?: unknown, info?: unknown) => void,
  ) => void;

  export class Strategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: string;
  }
}
