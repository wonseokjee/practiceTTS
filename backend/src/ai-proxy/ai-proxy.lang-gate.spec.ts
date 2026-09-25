import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AiProxyController } from './ai-proxy.controller';
import { SpeechDataService } from '../speech-data/speech-data.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';

/**
 * STT·발음 채점은 클라이언트가 보낸 `lang`을 그대로 채점 엔진에 넘긴다.
 * 게이트(SUPPORTED_LOCALES)를 거치지 않으면 en-US 문을 열기 전에도 영어 발화가
 * 한글 규칙 채점기로 흘러 들어가고, 빠뜨리면 조용히 ko-KR로 채점된다.
 */
describe('AiProxyController lang 게이트', () => {
  let app: INestApplication;
  const post = jest.fn();

  beforeEach(async () => {
    post.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [AiProxyController],
      providers: [
        Reflector,
        RateLimitGuard,
        { provide: HttpService, useValue: { axiosRef: post } },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d: string) => d },
        },
        { provide: SpeechDataService, useValue: { saveRecording: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = {
            id: 'user-1',
            role: 'patient',
          };
          return true;
        },
      })
      .overrideGuard(OnboardingGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): App => app.getHttpServer() as App;

  it.each(['/ai/stt', '/ai/pronunciation'])(
    '%s: lang이 없으면 400 LANG_UNSUPPORTED — 조용히 ko-KR로 채점하지 않는다',
    async (path) => {
      const res = await request(server())
        .post(path)
        .field('reference_text', '바다')
        .attach('audio', Buffer.from('x'), 'a.wav');
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('LANG_UNSUPPORTED');
      expect(post).not.toHaveBeenCalled();
    },
  );

  it.each(['/ai/stt', '/ai/pronunciation'])(
    '%s: 지원 목록 밖 로케일(en-US)은 400 — 문을 여는 커밋 전에는 열리지 않는다',
    async (path) => {
      const res = await request(server())
        .post(path)
        .field('lang', 'en-US')
        .field('reference_text', 'sea')
        .attach('audio', Buffer.from('x'), 'a.wav');
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('LANG_UNSUPPORTED');
      expect(post).not.toHaveBeenCalled();
    },
  );
});
