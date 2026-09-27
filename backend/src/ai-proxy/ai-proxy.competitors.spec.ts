import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AiProxyController } from './ai-proxy.controller';
import { SpeechDataService } from '../speech-data/speech-data.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GlobalCapGuard } from '../usage/global-cap.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';

/**
 * `/ai/pronunciation` 경쟁자 모드(이웃 비교 채점)의 프록시 동작.
 *
 * 프록시가 하는 일은 셋이다: 형식·크기 검증, 검증한 값을 ai-service 폼에 그대로 싣기,
 * 안 쓰는 요청은 폼이 예전과 같게 두기. 채점·판정은 여기서 하지 않는다.
 */
describe('AiProxyController /ai/pronunciation 경쟁자 모드', () => {
  let app: INestApplication;
  const post = jest.fn();
  const saveRecording = jest.fn();

  const UPSTREAM_PLAIN = {
    recognized_text: '바다',
    accuracy_score: 91,
    pronunciation_score: 90,
    engine: 'azure',
  };

  beforeEach(async () => {
    post.mockReset();
    saveRecording.mockReset();
    post.mockReturnValue(of({ data: UPSTREAM_PLAIN }));
    const moduleRef = await Test.createTestingModule({
      controllers: [AiProxyController],
      providers: [
        Reflector,
        RateLimitGuard,
        { provide: HttpService, useValue: { post } },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d: string) => d },
        },
        { provide: SpeechDataService, useValue: { saveRecording } },
      ],
    })
      // 서비스 전체 일일 상한은 global-cap.guard.spec이 본다. 여기선 라우트 로직만.
      .overrideGuard(GlobalCapGuard)
      .useValue({ canActivate: () => true })
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

  const base = () =>
    request(server())
      .post('/ai/pronunciation')
      .field('lang', 'ko-KR')
      .field('reference_text', '바다')
      .attach('audio', Buffer.from('x'), 'a.wav');

  /** ai-service로 나간 폼. */
  const forwarded = (): FormData =>
    (post.mock.calls[0] as [string, FormData])[1];

  it('경쟁자 필드가 없는 요청은 ai-service 폼이 예전과 같다', async () => {
    const res = await base();
    expect(res.status).toBe(200);
    const form = forwarded();
    expect([...form.keys()].sort()).toEqual([
      'audio',
      'lang',
      'reference_text',
    ]);
    expect(res.body).toEqual(UPSTREAM_PLAIN);
  });

  it('빈 배열·false는 경쟁자 모드가 아니다 — 폼에 안 싣는다', async () => {
    const res = await base()
      .field('competitors', '[]')
      .field('stt_competitor', 'false');
    expect(res.status).toBe(200);
    expect([...forwarded().keys()].sort()).toEqual([
      'audio',
      'lang',
      'reference_text',
    ]);
  });

  it('competitors·stt_competitor를 검증해 그대로 싣고, 응답의 새 필드를 통과시킨다', async () => {
    const upstream = {
      ...UPSTREAM_PLAIN,
      competitor_scores: [
        {
          text: '구름',
          source: 'neighbor',
          accuracy_score: 20,
          recognized_text: '구름',
          status: 'ok',
        },
      ],
      stt_transcript: '노래',
      stt_status: 'ok',
      competitors_skipped: null,
    };
    post.mockReturnValue(of({ data: upstream }));

    const res = await base()
      .field('competitors', JSON.stringify([' 구름 ', '', '가위']))
      .field('stt_competitor', 'true');

    expect(res.status).toBe(200);
    const form = forwarded();
    expect(form.get('competitors')).toBe(JSON.stringify(['구름', '가위'])); // 정리해서 싣는다
    expect(form.get('stt_competitor')).toBe('true');
    expect(form.get('reference_text')).toBe('바다');
    expect(res.body).toEqual(upstream);
  });

  it('STT만 요청해도 경쟁자 모드다', async () => {
    await base().field('stt_competitor', 'true');
    const form = forwarded();
    expect(form.has('competitors')).toBe(false);
    expect(form.get('stt_competitor')).toBe('true');
  });

  it.each([
    ['JSON이 아님', 'competitors', 'not json'],
    ['숫자 배열', 'competitors', '[1,2]'],
    ['6개', 'competitors', JSON.stringify(Array(6).fill('가'))],
    ['31자', 'competitors', JSON.stringify(['가'.repeat(31)])],
    ['stt_competitor 오표기', 'stt_competitor', 'yes'],
  ])(
    '%s → 400 COMPETITORS_INVALID, ai-service를 부르지 않는다',
    async (_n, field, value) => {
      const res = await base().field(field, value);
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('COMPETITORS_INVALID');
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('녹음 보존은 경쟁자 모드에서도 목표·전사·점수로 그대로 남긴다', async () => {
    await base()
      .field('competitors', JSON.stringify(['구름']))
      .field('stt_competitor', 'true');
    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'pronunciation',
        targetText: '바다',
        recognizedText: '바다',
        score: 90,
      }),
    );
  });
});
