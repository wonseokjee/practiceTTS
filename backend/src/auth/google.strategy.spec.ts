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

  it('검증된 이메일(_json.email_verified)이면 emailVerified=true로 정규화한다', () => {
    const strat = build();
    const done = jest.fn();
    const profile = {
      id: 'g-123',
      displayName: '김구글',
      emails: [{ value: 'user@gmail.com' }],
      _json: { email_verified: true },
    } as unknown as Profile;

    strat.validate('access', 'refresh', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerUserId: 'g-123',
      email: 'user@gmail.com',
      emailVerified: true,
      displayName: '김구글',
    });
  });

  it('email_verified 정보가 없으면 emailVerified=false(자동연결 불가)', () => {
    const strat = build();
    const done = jest.fn();
    const profile = {
      id: 'g-7',
      displayName: '김구글',
      emails: [{ value: 'user@gmail.com' }],
    } as unknown as Profile;

    strat.validate('access', 'refresh', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerUserId: 'g-7',
      email: 'user@gmail.com',
      emailVerified: false,
      displayName: '김구글',
    });
  });

  it('이메일이 없으면 email=null·emailVerified=false, 이름 없으면 기본값', () => {
    const strat = build();
    const done = jest.fn();
    const profile = { id: 'g-9' } as unknown as Profile;

    strat.validate('a', 'b', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerUserId: 'g-9',
      email: null,
      emailVerified: false,
      displayName: '구글 사용자',
    });
  });
});
