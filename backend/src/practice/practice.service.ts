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
    await this.practiceResultRepository
      .createQueryBuilder()
      .insert()
      .into(PracticeResult)
      .values(rows)
      .orIgnore()
      .execute();

    return { saved: rows.length };
  }
}
