import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { SettingsController } from './settings.controller';

/**
 * 가드 배선 — 로케일 쓰기는 인증 + 온보딩 완료 뒤에만. 지원 목록 조회는
 * 온보딩 도중(환자 연결 전)에도 열려 있어야 한다.
 */
describe('SettingsController 가드', () => {
  const guardsOf = (target: object): unknown[] =>
    (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
  const method = (name: string): object =>
    (SettingsController.prototype as unknown as Record<string, object>)[name];

  it('컨트롤러 전체가 JwtAuthGuard 뒤에 있다', () => {
    expect(guardsOf(SettingsController)).toContain(JwtAuthGuard);
  });

  it.each(['getLocale', 'updateLocale'])(
    '%s는 OnboardingGuard도 건다',
    (name) => {
      expect(guardsOf(method(name))).toContain(OnboardingGuard);
    },
  );

  it('getSupportedLocales는 OnboardingGuard를 걸지 않는다', () => {
    expect(guardsOf(method('getSupportedLocales'))).not.toContain(
      OnboardingGuard,
    );
  });
});
