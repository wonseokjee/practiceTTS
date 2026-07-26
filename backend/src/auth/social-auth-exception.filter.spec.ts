import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialAuthExceptionFilter } from './social-auth-exception.filter';

function mockHost(redirect: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ redirect }),
      getRequest: () => ({ path: '/auth/kakao/callback' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('SocialAuthExceptionFilter', () => {
  function build(frontend?: string): SocialAuthExceptionFilter {
    const config = {
      get: () => frontend,
    } as unknown as ConfigService;
    return new SocialAuthExceptionFilter(config);
  }

  it('콜백 예외를 프론트 로그인(error=social)으로 리다이렉트한다', () => {
    const redirect = jest.fn();
    const filter = build('https://app.example.com');

    filter.catch(new UnauthorizedException('state 불일치'), mockHost(redirect));

    expect(redirect).toHaveBeenCalledWith(
      'https://app.example.com/login?error=social',
    );
  });

  it('FRONTEND_URL 미설정 시 로컬 폴백으로 리다이렉트한다', () => {
    const redirect = jest.fn();
    const filter = build(undefined);

    filter.catch(new Error('아무 예외'), mockHost(redirect));

    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:5173/login?error=social',
    );
  });
});
