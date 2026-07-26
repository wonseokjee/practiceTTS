import { ConfigService } from '@nestjs/config';
import { GoogleStrategy } from './google.strategy';
import type { Profile } from 'passport-google-oauth20';

describe('GoogleStrategy', () => {
  function build(): GoogleStrategy {
    const config = {
      get: (k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'test-id' : 'test'),
    } as unknown as ConfigService;
    return new GoogleStrategy(config);
  }

  it('구글 프로필을 SocialProfile(provider=google, email 추출)로 정규화한다', () => {
    const strat = build();
    const done = jest.fn();
    const profile = {
      id: 'g-123',
      displayName: '김구글',
      emails: [{ value: 'user@gmail.com' }],
    } as unknown as Profile;

    strat.validate('access', 'refresh', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerUserId: 'g-123',
      email: 'user@gmail.com',
      displayName: '김구글',
    });
  });

  it('이메일이 없으면 email=null, 이름 없으면 기본값', () => {
    const strat = build();
    const done = jest.fn();
    const profile = { id: 'g-9' } as unknown as Profile;

    strat.validate('a', 'b', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerUserId: 'g-9',
      email: null,
      displayName: '구글 사용자',
    });
  });
});
