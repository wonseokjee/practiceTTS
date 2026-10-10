import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import {
  DEFAULT_TIMEZONE,
  dayBucket,
  dayWindowStart,
} from '../common/week-boundary';
import { Repository } from 'typeorm';
import { PracticeResult } from './entities/practice-result.entity';
import type { SubmitPracticeResultsDto } from './dto/submit-practice-results.dto';
import type { PracticeItemKind } from './constants/practice-item-kind';

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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
   * 날짜 경계는 **환자 프로필의 타임존** 기준(M27) — 검사의 getActivityDays와
   * 같은 규칙이라 두 목록을 합쳐도 경계가 어긋나지 않는다. 예전에는 서버 세션
   * 타임존이라, 서버가 KST면 미국 환자의 '오늘'이 KST 자정으로 잘렸다.
   */
  async getActivityDays(patientId: string, days = 14): Promise<string[]> {
    // 검사의 getActivityDays와 **같은 환자 행**에서 타임존을 읽는다. 두 목록을
    // 합쳐도 경계가 어긋나지 않아야 한다는 아래 규칙이 이걸로 지켜진다.
    const user = await this.userRepository.findOne({
      where: { id: patientId },
      select: { id: true, timezone: true },
    });
    const timezone = user?.timezone ?? DEFAULT_TIMEZONE;
    const bucket = dayBucket('p.created_at', timezone);
    const raw = await this.practiceResultRepository
      .createQueryBuilder('p')
      .select(`to_char(${bucket}, 'YYYY-MM-DD')`, 'day')
      .distinct(true)
      .where('p.patient_id = :pid', { pid: patientId })
      .andWhere(`p.created_at >= ${dayWindowStart(timezone, days)}`)
      .orderBy('day', 'DESC')
      .getRawMany<{ day: string }>();
    return raw.map((x) => x.day);
  }

  /**
   * 보호자용 연습 요약(최근 days일) — 한 양과 **첫 시도 정답률**.
   *
   * **원칙을 바꾼 지점이다(2026-10-10, 사용자 결정).** 위 getActivityDays는
   * "정답률은 내보내지 않는다"였다. 로컬 테스트에서 보호자가 "가볍게 연습하기는
   * 기록되지 않네"라고 했고, 한 일만 보여주는 안과 정답률까지 보여주는 안 중
   * 정답률까지를 골랐다. 오염 논리(연습이 검사 측정값을 덮는다)는 그대로라,
   * 이 값은 **검사 테이블과 합치지 않고** 화면에서도 검사 점수와 따로 둔다.
   *
   * 정답률은 **첫 시도**만 센다. 터치 문항은 틀리면 정답을 보여주고 다시 고르게
   * 하므로(재시도 3회), 마지막 시도를 세면 거의 늘 맞은 것으로 나온다.
   * 판정이 없는 발화(Tier 1, is_correct NULL)는 "한 문항"에는 넣고 정답률
   * 분모에서는 뺀다 — 채점하지 않은 것을 오답으로 접으면 안 된다.
   *
   * 날짜 창은 getActivityDays와 같은 규칙(환자 프로필 타임존의 자정).
   */
  async getSummary(patientId: string, days = 7): Promise<PracticeSummary> {
    const user = await this.userRepository.findOne({
      where: { id: patientId },
      select: { id: true, timezone: true },
    });
    const timezone = user?.timezone ?? DEFAULT_TIMEZONE;
    const since = dayWindowStart(timezone, days - 1);

    const rows = await this.practiceResultRepository
      .createQueryBuilder('p')
      .select('p.item_kind', 'kind')
      .addSelect('COUNT(DISTINCT (p.session_token, p.item_ref))::int', 'items')
      .addSelect(
        'COUNT(*) FILTER (WHERE p.attempt = 1 AND p.is_correct IS NOT NULL)::int',
        'judged',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE p.attempt = 1 AND p.is_correct)::int',
        'correct',
      )
      .where('p.patient_id = :pid', { pid: patientId })
      .andWhere(`p.created_at >= ${since}`)
      .groupBy('p.item_kind')
      .orderBy('p.item_kind')
      .getRawMany<{
        kind: PracticeItemKind;
        items: number;
        judged: number;
        correct: number;
      }>();

    const totals = await this.practiceResultRepository
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.session_token)::int', 'sessions')
      .addSelect('MAX(p.created_at)', 'last')
      .where('p.patient_id = :pid', { pid: patientId })
      .andWhere(`p.created_at >= ${since}`)
      .getRawOne<{ sessions: number; last: Date | null }>();

    const judged = rows.reduce((s, r) => s + r.judged, 0);
    const correct = rows.reduce((s, r) => s + r.correct, 0);
    return {
      days,
      sessions: totals?.sessions ?? 0,
      items: rows.reduce((s, r) => s + r.items, 0),
      firstTry: {
        judged,
        correct,
        rate: judged > 0 ? correct / judged : null,
      },
      byKind: rows,
      lastPracticedAt: totals?.last
        ? new Date(totals.last).toISOString()
        : null,
    };
  }
}

export interface PracticeSummary {
  days: number;
  /** 연습 세션 수(세션 토큰 기준) */
  sessions: number;
  /** 푼 문항 수 — 판정 없는 발화 포함 */
  items: number;
  /** 첫 시도 정답률. 판정 있는 문항이 없으면 rate는 null(0%가 아니다). */
  firstTry: { judged: number; correct: number; rate: number | null };
  byKind: {
    kind: PracticeItemKind;
    items: number;
    judged: number;
    correct: number;
  }[];
  lastPracticedAt: string | null;
}
