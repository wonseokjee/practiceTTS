import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, KakaoProfile } from 'passport-kakao';
import type { SocialProfile } from './social-profile';

/**
 * 카카오 OAuth 전략 (passport-kakao). 전략은 유저를 만들지 않는다 —
 * 카카오 프로필을 앱 표준형(SocialProfile)으로 정규화만 하고, 생성/조회는
 * AuthService.findOrCreateSocialUser가 담당한다(관심사 분리).
 *
 * 키가 없어도 부팅은 되게 한다(placeholder). 실제 카카오 로그인 시도에서만
 * 실패한다 — CRYPTO 키 검증과 같은 fail-soft.
 */
@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(configService: ConfigService) {
    super({
      clientID:
        configService.get<string>('KAKAO_CLIENT_ID') || 'not-configured',
      clientSecret: configService.get<string>('KAKAO_CLIENT_SECRET') || '',
      callbackURL:
        configService.get<string>('KAKAO_CALLBACK_URL') ||
        'http://localhost:3000/auth/kakao/callback',
    });
  }

  // 반환값이 Request.user에 주입된다. 콜백 핸들러가 이걸 받아 findOrCreate한다.
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: KakaoProfile,
  ): SocialProfile {
    const account = profile._json?.kakao_account;
    const nickname =
      account?.profile?.nickname ??
      profile._json?.properties?.nickname ??
      profile.username ??
      '카카오 사용자';
    return {
      provider: 'kakao',
      providerUserId: String(profile.id),
      email: account?.email ?? null,
      displayName: nickname,
    };
  }
}
