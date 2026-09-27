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
import { GlobalCapGuard } from '../usage/global-cap.guard';
import {
  RATE_LIMIT_KEY,
  RateLimitGuard,
  RateLimitOptions,
} from '../common/rate-limit.guard';

/**
 * STT 레이트리밋이 **업로드 파싱보다 먼저** 동작하는지 고정한다.
 *
 * 배경: 예전에는 핸들러 본문 첫 줄에서 한도를 검사했다. NestJS 실행 순서가
 * `가드 -> 인터셉터 -> 핸들러`라 FileInterceptor(multer)가 먼저 돌았고,
 * 결국 한도를 넘긴 요청도 매번 업로드 본문을 메모리에 다 올린 뒤에야 429를
 * 받았다.
 *
 * 유효한 JWT 하나로 큰 파일을 반복해 보내면 429는 나가지만 그 사이 힙이
 * 쌓인다. 단일 인스턴스 배포라 백엔드가 OOM으로 죽으면 사진·퀴즈·인증이
 * 전부 같이 죽는다 — 레이트리밋이 지키려던 자원 소진을 정작 못 막았다.
 */
describe('AiProxyController 레이트리밋', () => {
  let app: INestApplication;
  const USER_ID = 'user-1';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiProxyController],
      providers: [
        Reflector,
        RateLimitGuard,
        { provide: HttpService, useValue: { axiosRef: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d: string) => d },
        },
        {
          provide: SpeechDataService,
          useValue: { saveRecording: jest.fn() },
        },
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
          ctx.switchToHttp().getRequest().user = { id: USER_ID };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * supertest에 넘길 서버. `getHttpServer()`가 any를 주므로 여기서 한 번만
   * 좁힌다 — 호출부마다 any가 퍼지지 않게.
   */
  const server = (): App => app.getHttpServer() as App;

  /** STT 한도(12/분)를 소진시킨다. */
  async function exhaustSttLimit(): Promise<void> {
    for (let i = 0; i < 12; i += 1) {
      await request(server())
        .post('/ai/stt')
        .attach('audio', Buffer.from('x'), 'a.wav');
    }
  }

  it('한도를 넘으면 429를 준다', async () => {
    await exhaustSttLimit();

    const res = await request(server())
      .post('/ai/stt')
      .attach('audio', Buffer.from('x'), 'a.wav');

    expect(res.status).toBe(429);
  });

  it('레이트리밋이 가드로 선언돼 있다 (핸들러 본문이 아니라)', () => {
    // 이것이 이 수정의 핵심 불변식이다.
    //
    // NestJS의 실행 순서(가드 -> 인터셉터 -> 핸들러)는 프레임워크가 보장하므로
    // 테스트할 대상이 아니다. 회귀할 수 있는 건 **우리 쪽 선언**이다 —
    // 누군가 편의상 검사를 핸들러 본문으로 되돌리면 multer가 먼저 돌아
    // 한도를 넘긴 요청도 업로드 본문을 메모리에 다 올리게 된다.
    const reflector = new Reflector();

    // 핸들러를 **호출하지 않고** 메타데이터 키로만 쓴다. this가 없어도 되므로
    // unbound-method 경고는 여기서만 끈다.
    /* eslint-disable @typescript-eslint/unbound-method */
    const sttMeta = reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      AiProxyController.prototype.stt,
    );
    const ttsMeta = reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      AiProxyController.prototype.tts,
    );
    const pronMeta = reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      AiProxyController.prototype.pronunciation,
    );
    /* eslint-enable @typescript-eslint/unbound-method */

    expect(sttMeta).toMatchObject({ name: 'stt' });
    expect(ttsMeta).toMatchObject({ name: 'tts' });
    expect(pronMeta).toMatchObject({ name: 'pronunciation' });

    // 컨트롤러 가드에 RateLimitGuard가 JwtAuthGuard **뒤에** 있어야
    // req.user.id로 버킷을 나눌 수 있다. 중간에 OnboardingGuard(온보딩 전
    // 보호자 차단)가 끼어도 이 불변식은 유지된다 — RateLimit는 auth 뒤.
    const guards = Reflect.getMetadata('__guards__', AiProxyController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.[0]).toBe(JwtAuthGuard);
    // RateLimitGuard는 JwtAuthGuard보다 뒤(인덱스가 크다)에 온다.
    const jwtIdx = guards?.indexOf(JwtAuthGuard) ?? -1;
    const rlIdx = guards?.indexOf(RateLimitGuard) ?? -1;
    expect(rlIdx).toBeGreaterThan(jwtIdx);
  });

  it('429에 Retry-After를 실어준다', async () => {
    // 없으면 클라이언트가 즉시 재시도 루프에 빠져 부하를 더 키운다.
    await exhaustSttLimit();

    const res = await request(server())
      .post('/ai/stt')
      .attach('audio', Buffer.from('x'), 'a.wav');

    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('STT와 TTS 한도는 서로 간섭하지 않는다', async () => {
    await exhaustSttLimit();

    const res = await request(server()).get('/ai/tts?text=안녕');

    expect(res.status).not.toBe(429);
  });
});
