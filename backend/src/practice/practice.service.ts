import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PracticeResult } from './entities/practice-result.entity';
import type { SubmitPracticeResultsDto } from './dto/submit-practice-results.dto';

/**
 * 연습 모드 결과 저장.
 *
 * **이 서비스가 하지 않는 일이 설계의 핵심이다.**
 *
 *  - 레벨을 재계산하지 않는다 (검사의 recomputeSkillLevel에 대응하는 것이 없다)
 *  - 문항 회전 우선순위를 갱신하지 않는다
 *  - 보호자 정확도 추세에 기여하지 않는다
 *  - 완료/이탈 마커를 남기지 않는다
 *
 * 연습은 한 세션 40문항으로 검사(13문항)를 3:1로 압도하므로, 위 중 하나라도
 * 연결하면 연습 성적이 곧 환자의 측정값이 된다. 연습은 쌓이기만 하고 아무것도
 * 움직이지 않는다.
 */
@Injectable()
export class PracticeService {
  constructor(
    @InjectRepository(PracticeResult)
    private readonly practiceResultRepository: Repository<PracticeResult>,
  ) {}

  async saveResults(
    patientId: string,
    dto: SubmitPracticeResultsDto,
  ): Promise<{ saved: number }> {
    if (dto.results.length === 0) {
      // 빈 tail은 무해한 no-op. 검사와 달리 여기엔 함께 남길 완료 마커가 없으므로
      // 그냥 돌아간다.
      return { saved: 0 };
    }

    const rows = dto.results.map((r) =>
      this.practiceResultRepository.create({
        patientId,
        sessionToken: dto.sessionToken,
        itemKind: r.itemKind,
        itemRef: r.itemRef,
        attempt: r.attempt ?? 1,
        // 생략은 "판정 없음"(Tier 1)이지 "오답"이 아니다. ?? false로 접으면
        // 채점하지 않은 발화가 전부 실패로 기록된다.
        isCorrect: r.isCorrect ?? null,
        tier: r.tier,
      }),
    );

    // 멱등은 DB가 제공한다 — UNIQUE (patient, session, item, attempt) + DO NOTHING.
    // 예외를 던지지 않으므로 재제출·중복 flush가 트랜잭션을 깨뜨리지 않는다.
    //
    // RETURNING id를 붙이는 이유. `ON CONFLICT DO NOTHING`은 **실제로 들어간
    // 행만** 돌려준다. 예전에는 접수한 개수(rows.length)를 saved로 내보냈는데,
    // 중복 제출이면 DB에는 0행이 들어가는데도 saved가 1이었다. 지금은 아무도
    // 이 값을 안 봐서 무해하지만, 나중에 이 숫자로 판단하면 조용히 틀린다 —
    // "저장했다"는 이름을 달고 저장 안 된 것을 세는 값이기 때문이다.
    const result = await this.practiceResultRepository
      .createQueryBuilder()
      .insert()
      .into(PracticeResult)
      .values(rows)
      .orIgnore()
      .returning('id')
      .execute();

    // raw는 RETURNING이 준 행 배열. 드라이버가 안 주면(테스트 목 등) 접수 수로
    // 물러난다 — 숫자를 지어내는 것보다 낫다.
    const returned: unknown = result.raw;
    return {
      saved: Array.isArray(returned) ? returned.length : rows.length,
    };
  }

  /**
   * 연습을 한 날짜 목록(최근 days일, YYYY-MM-DD).
   *
   * **위의 "아무것도 움직이지 않는다"에 대한 유일한 예외이자, 예외가 아니다.**
   * 이 조회가 주는 것은 "했다/안 했다"뿐이다. 정답률도 레벨도 추세도 나가지
   * 않는다. 오염 논리가 막으려던 것은 연습 40문항이 검사 13문항을 압도해
   * 환자의 **측정값**이 되는 것이지, 환자가 참여했다는 사실이 아니다.
   *
   * 이걸 안 내보내면 어르신이 하루 세 번 연습해도 보호자 화면에는 "오늘 아무것도
   * 안 했네"로 보인다. 측정 오염을 막으려다 참여 기록까지 지운 셈이 된다.
   *
   * 날짜 경계는 DB 세션 타임존 기준 — 검사의 getActivityDays와 같은 규칙이라
   * 두 목록을 합쳐도 경계가 어긋나지 않는다.
   */
  async getActivityDays(patientId: string, days = 14): Promise<string[]> {
    const raw = await this.practiceResultRepository
      .createQueryBuilder('p')
      .select("to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD')", 'day')
      .distinct(true)
      .where('p.patient_id = :pid', { pid: patientId })
      .andWhere('p.created_at >= now() - make_interval(days => :days)', {
        days,
      })
      .orderBy('day', 'DESC')
      .getRawMany<{ day: string }>();
    return raw.map((x) => x.day);
  }
}
