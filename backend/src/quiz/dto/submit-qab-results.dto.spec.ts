import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitQabResultsDto } from './submit-qab-results.dto';

/**
 * `answeredAt`(푼 시각) 입력 검증 — 계획 OV-B.
 *
 * 서비스는 받은 문자열을 `new Date()`로 읽는다. 형식이 느슨하면 `new Date`가
 * 브라우저·런타임마다 다르게 해석하는 문자열('2026-09-14 10:00' 같은)이 들어와,
 * 같은 결과가 환경에 따라 다른 날로 저장될 수 있다. 그래서 ISO 8601만 받는다.
 */
async function errorsFor(answeredAt: unknown): Promise<string[]> {
  const dto = plainToInstance(SubmitQabResultsDto, {
    sessionToken: '6f1c2b1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b',
    results: [
      { subtest: 'word', itemRef: 'qw_001', isCorrect: true, answeredAt },
    ],
  });
  const errors = await validate(dto);
  return errors.flatMap((e) =>
    (e.children ?? []).flatMap((c) =>
      (c.children ?? []).map((cc) => cc.property),
    ),
  );
}

describe('SubmitQabResultsDto — answeredAt', () => {
  it('ISO 8601 시각을 받는다', async () => {
    expect(await errorsFor('2026-09-14T10:00:00.000Z')).toEqual([]);
    expect(await errorsFor('2026-09-14T19:00:00+09:00')).toEqual([]);
  });

  it('생략해도 된다 — 옛 클라이언트', async () => {
    expect(await errorsFor(undefined)).toEqual([]);
  });

  it('ISO가 아닌 시각 문자열은 거부한다', async () => {
    expect(await errorsFor('2026-09-14 10:00')).toContain('answeredAt');
    expect(await errorsFor('Mon Sep 14 2026')).toContain('answeredAt');
  });

  it('시간대 표기가 없으면 거부한다 — 서버 현지 시각으로 읽힌다', async () => {
    // validator.js의 isISO8601은 이 둘을 받는다. 그대로 두면 서버 TZ에 따라
    // 저장되는 날짜가 달라진다.
    expect(await errorsFor('2026-09-14T10:00:00')).toContain('answeredAt');
    expect(await errorsFor('2026-09-14T10:00:00.000')).toContain('answeredAt');
  });

  it('날짜만 있으면 거부한다 — 푼 "시각"이 아니다', async () => {
    expect(await errorsFor('2026-09-14')).toContain('answeredAt');
  });

  it('있을 수 없는 날짜는 거부한다(strict)', async () => {
    expect(await errorsFor('2026-02-30T10:00:00Z')).toContain('answeredAt');
  });

  it('숫자(epoch)는 거부한다', async () => {
    expect(await errorsFor(1_757_844_000_000)).toContain('answeredAt');
  });
});

/**
 * `scorerVersion`·`unscoredReason`(M33) — 이웃 비교 채점의 기록 필드.
 *
 * 둘 다 관측값이라 채점에는 안 쓰지만 목록 밖의 값이 저장되면 집계(`ARRAY_AGG`)와 화면의
 * "채점 방식이 바뀌었어요"가 알 수 없는 버전을 그대로 노출한다. `foilKind`처럼 목록으로 지킨다.
 */
async function itemErrorsFor(
  extra: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(SubmitQabResultsDto, {
    sessionToken: '6f1c2b1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b',
    results: [
      {
        subtest: 'naming',
        itemRef: 'naming_qw_001',
        isCorrect: false,
        ...extra,
      },
    ],
  });
  const errors = await validate(dto);
  return errors.flatMap((e) =>
    (e.children ?? []).flatMap((c) =>
      (c.children ?? []).map((cc) => cc.property),
    ),
  );
}

describe('SubmitQabResultsDto — scorerVersion · unscoredReason', () => {
  it('알려진 채점기 버전과 채점 불가 이유를 받는다', async () => {
    expect(await itemErrorsFor({ scorerVersion: 'azure-pa-v1' })).toEqual([]);
    expect(await itemErrorsFor({ scorerVersion: 'azure-pa-nbr-v1' })).toEqual(
      [],
    );
    expect(
      await itemErrorsFor({ unscored: true, unscoredReason: 'ambiguous' }),
    ).toEqual([]);
    expect(
      await itemErrorsFor({ unscored: true, unscoredReason: 'no_score' }),
    ).toEqual([]);
  });

  it('생략해도 된다 — 옛 클라이언트', async () => {
    expect(await itemErrorsFor({})).toEqual([]);
  });

  it('목록 밖의 값은 거부한다', async () => {
    expect(await itemErrorsFor({ scorerVersion: 'azure-pa-v2' })).toContain(
      'scorerVersion',
    );
    expect(await itemErrorsFor({ scorerVersion: '' })).toContain(
      'scorerVersion',
    );
    expect(await itemErrorsFor({ scorerVersion: 1 })).toContain(
      'scorerVersion',
    );
    expect(await itemErrorsFor({ unscoredReason: 'timeout' })).toContain(
      'unscoredReason',
    );
    expect(await itemErrorsFor({ unscoredReason: true })).toContain(
      'unscoredReason',
    );
  });
});

describe('SubmitQabResultsDto — ambiguousRetries', () => {
  it('0~3 정수를 받는다', async () => {
    for (const n of [0, 1, 2, 3]) {
      expect(await itemErrorsFor({ ambiguousRetries: n })).toEqual([]);
    }
  });

  it('생략해도 된다 — 이웃 비교를 안 거친 시도(NULL)다', async () => {
    expect(await itemErrorsFor({})).toEqual([]);
  });

  it('범위 밖·정수 아님·숫자 아님은 거부한다', async () => {
    for (const bad of [-1, 4, 1.5, '1', true]) {
      expect(await itemErrorsFor({ ambiguousRetries: bad })).toContain(
        'ambiguousRetries',
      );
    }
  });
});
