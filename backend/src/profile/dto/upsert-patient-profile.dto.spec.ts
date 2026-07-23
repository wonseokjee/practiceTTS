// class-transformer/validator 데코레이터는 Reflect.getMetadata를 쓴다.
// NestJS 테스트 모듈을 거치지 않는 순수 DTO 테스트라 여기서 직접 로드한다.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_FAMILY_MEMBERS } from '../constants/profile.constants';
import { UpsertPatientProfileDto } from './upsert-patient-profile.dto';

/**
 * 프로필 입력 검증 테스트.
 *
 * 회귀 배경:
 * - family에 상한 검증이 없어, 상한 초과분을 서비스의 slice()가 조용히 버리고
 *   200을 돌려줬다. 보호자는 저장된 줄 알고 넘어간다.
 * - 이름 1자를 허용해, 그 글자가 든 무관한 낱말까지 토큰으로 치환됐다
 *   ("김밥" → "[아들1]밥"). LLM에 넘길 텍스트가 망가진다.
 */
describe('UpsertPatientProfileDto', () => {
  function validate(payload: unknown): string[] {
    const dto = plainToInstance(UpsertPatientProfileDto, payload);
    return validateSync(dto, { whitelist: true }).flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...(e.children ?? []).flatMap((c) =>
        Object.values(c.constraints ?? {}).concat(
          (c.children ?? []).flatMap((cc) =>
            Object.values(cc.constraints ?? {}),
          ),
        ),
      ),
    ]);
  }

  function family(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      relation: 'son',
      name: `아들${i}`,
    }));
  }

  it('가족이 상한 이내면 통과한다', () => {
    expect(validate({ family: family(MAX_FAMILY_MEMBERS) })).toHaveLength(0);
  });

  it('가족이 상한을 넘으면 거절한다 (조용히 버리지 않는다)', () => {
    const errors = validate({ family: family(MAX_FAMILY_MEMBERS + 1) });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain(`최대 ${MAX_FAMILY_MEMBERS}명`);
  });

  it('1자 이름은 거절한다 (노트 본문이 오치환된다)', () => {
    const errors = validate({ family: [{ relation: 'son', name: '김' }] });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('이름은 2~');
  });

  it('2자 이상 이름은 통과한다', () => {
    expect(
      validate({ family: [{ relation: 'son', name: '철수' }] }),
    ).toHaveLength(0);
  });

  it('허용되지 않은 relation은 거절한다', () => {
    const errors = validate({ family: [{ relation: 'robot', name: '철수' }] });

    expect(errors.length).toBeGreaterThan(0);
  });
});
