import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocaleSettingsService } from './locale-settings.service';
import { SettingsController } from './settings.controller';

/**
 * 게이트(계획서 0-5c)를 **HTTP 경계에서** 본다 — `main.ts`와 같은
 * `ValidationPipe`, 진짜 `OnboardingGuard`를 거친다. 인증만 대역이다.
 * 서비스 단위 테스트는 DTO 모양 검사·미지 필드 거부를 못 본다.
 */
describe('Settings HTTP', () => {
  let app: INestApplication<App>;
  let currentUser: User;
  const transaction = jest.fn();

  beforeAll(async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: (fn: (m: unknown) => unknown) => {
          transaction();
          return fn({ getRepository: () => ({ update: jest.fn() }) });
        },
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        LocaleSettingsService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: User }>().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts와 같은 설정 — 여기가 달라지면 이 테스트가 보는 게 운영과 다르다.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    transaction.mockClear();
    currentUser = {
      id: 'caregiver-1',
      role: 'caregiver',
      patientId: 'patient-1',
    } as User;
  });

  it('GET /settings/locales — 지원 목록(지금은 ko-KR만)', async () => {
    const res = await request(app.getHttpServer()).get('/settings/locales');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ patient: ['ko-KR'], caregiver: ['ko-KR'] });
  });

  it('PUT en-US → 400, 아무것도 쓰지 않는다 (문이 닫혀 있다)', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/locale')
      .send({ caregiverLocale: 'en-US' });

    expect(res.status).toBe(400);
    const body = res.body as { message?: unknown };
    expect(String(body.message)).toContain('지원하지 않는');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('PUT 모양이 틀린 값 → 400 (DTO)', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/locale')
      .send({ patientLocale: 'english' });
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('PUT 모르는 필드 → 400 (forbidNonWhitelisted) — locale 한 필드로 둘을 우회하지 못한다', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/locale')
      .send({ locale: 'en-US' });
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('PUT ko-KR → 200', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/locale')
      .send({ patientLocale: 'ko-KR' });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('온보딩 전 보호자(patient_id 없음)는 PUT이 403 — 지원 목록 조회는 된다', async () => {
    currentUser = { id: 'c-2', role: 'caregiver', patientId: null } as User;

    const put = await request(app.getHttpServer())
      .put('/settings/locale')
      .send({ patientLocale: 'ko-KR' });
    expect(put.status).toBe(403);

    const get = await request(app.getHttpServer()).get('/settings/locales');
    expect(get.status).toBe(200);
  });
});
