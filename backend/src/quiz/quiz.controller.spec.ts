// QuizController — 최근 문항 이력 라우트(`GET /quiz/recent-items`).
//
// 이 라우트는 글자 조합의 **간격 반복**을 먹여 살린다. 서비스가 (틀린 것 먼저,
// 그 안에서 오래된 것 먼저) 순으로 주고 프론트가 그 순서를 그대로 우선순위로
// 쓰므로, 컨트롤러가 조용히 잘못된 subtest를 흘려보내면 빈 배열이 내려가고
// 반복은 무작위로 퇴화한다 — 예외도, 로그도 없이.

import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { PracticeService } from '../practice/practice.service';
import { DailyCapGuard } from '../usage/daily-cap.guard';
import { GlobalCapGuard } from '../usage/global-cap.guard';
import type { User } from '../auth/entities/user.entity';

const PATIENT_ID = 'patient-1';

/**
 * 환자 본인으로 인증된 요청.
 *
 * 캐스팅이 필요한 이유: 컨트롤러의 `AuthenticatedRequest`가 express Request가
 * 아니라 **전역 DOM `Request`(fetch)** 를 확장하고 있다 — 파일에 express import가
 * 없어서다. 이 브랜치가 만든 문제는 아니고 컨트롤러 전체에 걸린 기존 부채라
 * 여기서 고치지 않는다. 핸들러는 `req.user`만 읽으므로 동작에는 영향이 없다.
 */
type ReqArg = Parameters<QuizController['getRecentItems']>[0];
const patientReq = {
  user: { id: PATIENT_ID, role: 'patient', patientId: null } as User,
} as unknown as ReqArg;

describe('QuizController — recent-items', () => {
  let controller: QuizController;
  let getRecentItems: jest.Mock;

  beforeEach(async () => {
    getRecentItems = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      controllers: [QuizController],
      providers: [
        { provide: QuizService, useValue: { getRecentItems } },
        { provide: PracticeService, useValue: { getActivityDays: jest.fn() } },
      ],
    })
      // 일일 생성 상한은 daily-cap.guard.spec이 본다. 여기선 라우트 로직만.
      .overrideGuard(DailyCapGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GlobalCapGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(QuizController);
  });

  it('알 수 없는 검사 종류는 422로 거절한다', async () => {
    // 서비스까지 흘려보내면 빈 배열이 나와 "이력이 없다"와 구분되지 않는다.
    await expect(
      controller.getRecentItems(patientReq, 'not-a-subtest'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(getRecentItems).not.toHaveBeenCalled();
  });

  it('subtest가 아예 없으면 422로 거절한다', async () => {
    await expect(controller.getRecentItems(patientReq)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(getRecentItems).not.toHaveBeenCalled();
  });

  it('올바른 검사 종류는 그대로 서비스에 넘긴다', async () => {
    await controller.getRecentItems(patientReq, 'spell');

    expect(getRecentItems).toHaveBeenCalledWith(PATIENT_ID, 'spell', 30);
  });

  it('범위를 벗어난 days는 기본값 30으로 되돌린다', async () => {
    // 사용자 입력이 그대로 오면 전체 이력을 훑게 된다.
    await controller.getRecentItems(patientReq, 'spell', '9999');

    expect(getRecentItems).toHaveBeenCalledWith(PATIENT_ID, 'spell', 30);
  });

  it('유효한 days는 그대로 쓴다', async () => {
    await controller.getRecentItems(patientReq, 'spell', '7');

    expect(getRecentItems).toHaveBeenCalledWith(PATIENT_ID, 'spell', 7);
  });
});

/**
 * 활동 일자 — 검사와 연습의 합집합(TODO-111).
 *
 * 합치는 자리가 **컨트롤러**인 것이 요점이다. QuizService에 PracticeService를
 * 주입하면 레벨 재계산·보호자 추세 코드가 연습 데이터에 닿을 수 있게 된다.
 * 연습을 별도 테이블로 낸 이유가 정확히 그것을 막는 것이라, 통로를 라우트에
 * 가둔다. 아래 테스트가 그 경계를 지킨다.
 */
describe('QuizController — activity-days', () => {
  let controller: QuizController;
  let quizDays: jest.Mock;
  let practiceDays: jest.Mock;

  const build = async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QuizController],
      providers: [
        { provide: QuizService, useValue: { getActivityDays: quizDays } },
        {
          provide: PracticeService,
          useValue: { getActivityDays: practiceDays },
        },
      ],
    })
      .overrideGuard(DailyCapGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GlobalCapGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(QuizController);
  };

  beforeEach(async () => {
    quizDays = jest.fn().mockResolvedValue([]);
    practiceDays = jest.fn().mockResolvedValue([]);
    await build();
  });

  it('검사만 한 날과 연습만 한 날이 모두 들어온다', async () => {
    quizDays.mockResolvedValue(['2026-08-17']);
    practiceDays.mockResolvedValue(['2026-08-21', '2026-08-19']);

    const res = await controller.getActivityDays(patientReq);

    expect(res.days).toEqual(['2026-08-21', '2026-08-19', '2026-08-17']);
  });

  it('같은 날 둘 다 했으면 한 번만 센다', async () => {
    quizDays.mockResolvedValue(['2026-08-21']);
    practiceDays.mockResolvedValue(['2026-08-21']);

    const res = await controller.getActivityDays(patientReq);

    expect(res.days).toEqual(['2026-08-21']);
  });

  it('연습만 있어도 빈 배열이 아니다', async () => {
    // 이게 TODO-111의 증상이다 — 어제까지는 여기가 빈 배열이었고, 보호자
    // 화면에는 "오늘 아무것도 안 했네"로 보였다.
    practiceDays.mockResolvedValue(['2026-08-21']);

    const res = await controller.getActivityDays(patientReq);

    expect(res.days).toEqual(['2026-08-21']);
  });

  it('days 인자를 두 출처에 똑같이 넘긴다', async () => {
    await controller.getActivityDays(patientReq, '30');

    expect(quizDays).toHaveBeenCalledWith(PATIENT_ID, 30);
    expect(practiceDays).toHaveBeenCalledWith(PATIENT_ID, 30);
  });

  it('범위 밖 days는 두 출처 모두 기본값 14로 떨어진다', async () => {
    await controller.getActivityDays(patientReq, '999');

    expect(quizDays).toHaveBeenCalledWith(PATIENT_ID, 14);
    expect(practiceDays).toHaveBeenCalledWith(PATIENT_ID, 14);
  });
});
