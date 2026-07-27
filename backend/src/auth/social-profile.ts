import type { AuthProvider } from './entities/user.entity';

/**
 * 소셜 제공자 프로필을 앱 표준형으로 정규화한 것.
 * 전략(KakaoStrategy 등)이 이 형태로 넘기고, AuthService.findOrCreateSocialUser가
 * 이걸로 유저를 조회·생성한다. 제공자가 늘어도 이 계약은 그대로다.
 */
export interface SocialProfile {
  provider: Exclude<AuthProvider, 'local'>;
  /** 제공자 계정 고유 ID(카카오 회원번호 등). 문자열로 통일. */
  providerUserId: string;
  /** 이메일. 카카오는 동의 선택이라 없을 수 있다. */
  email: string | null;
  /**
   * provider가 이 이메일을 검증했는가. 계정 자동 연결(같은 이메일 → 기존 계정
   * 합류)은 검증된 이메일에만 허용한다 — 미검증 이메일로 붙이면 계정 탈취 위험.
   * 이메일이 없으면 의미 없으므로 false.
   */
  emailVerified: boolean;
  /** 표시 이름(닉네임). 없으면 제공자명 기반 기본값. */
  displayName: string;
}
