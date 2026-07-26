import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { SocialProfile } from './social-profile';

/**
 * 구글 OAuth 전략 (passport-google-oauth20). 카카오와 동일하게, 유저를 만들지
 * 않고 프로필을 SocialProfile로 정규화만 한다 — 생성/조회는 AuthService가 담당.
 * 구글은 이메일을 항상 준다(scope에 email 포함).
 *
 * 키가 없어도 부팅되게 placeholder(카카오와 동일 fail-soft).
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID:
        configService.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret:
        configService.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:3000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const social: SocialProfile = {
      provider: 'google',
      providerUserId: profile.id,
      email: profile.emails?.[0]?.value ?? null,
      displayName:
        profile.displayName || profile.name?.givenName || '구글 사용자',
    };
    done(null, social);
  }
}
