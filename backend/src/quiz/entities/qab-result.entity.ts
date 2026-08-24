import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { QabSubtest } from '../constants/qab-subtest';
import type { QabFoilKind } from '../constants/qab-foil-kind';

/**
 * QAB 질문형 검사 결과 1행 (항목 단위).
 *
 * QAB 문항은 프론트에서 생성되어 quiz_question 테이블에 없으므로, quiz_attempt를
 * 재사용할 수 없다. 회복 추적(보호자 가시성)을 위한 별도 경량 결과 테이블이다.
 *
 *  - subtest : 검사 종류(word/sentence/naming/repeat/reading/ddk)
 *  - itemRef : 프론트 문항 식별자(추적/디버깅용, 문자열)
 *  - isCorrect: 정오답(이해/말하기), ddk는 목표 도달 여부
 *  - metric  : 수치형 지표(현재 ddk 감지 횟수). 그 외 검사는 null.
 */
@Entity('qab_results')
@Index('IDX_qab_results_patient_subtest', ['patientId', 'subtest'])
@Index('IDX_qab_results_session', ['sessionToken'])
// 멱등성: 같은 세션의 같은 문항 결과는 1행만. 재시도/중복 제출 시 추세 이중 집계 방지.
@Index(
  'UQ_qab_results_dedup',
  ['patientId', 'sessionToken', 'subtest', 'itemRef'],
  {
    unique: true,
  },
)
export class QabResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_qab_results_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'session_token', type: 'uuid' })
  sessionToken: string;

  @Column({ name: 'subtest', type: 'varchar', length: 16 })
  subtest: QabSubtest;

  @Column({ name: 'item_ref', type: 'varchar', length: 100 })
  itemRef: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect: boolean;

  // 보호자가 "넘어가기"로 통과시킨 문항(도움받음). 회복 추세 정확도 집계에서 제외한다.
  @Column({ name: 'assisted', type: 'boolean', default: false })
  assisted: boolean;

  /**
   * 틀렸을 때 고른 오답의 갈래 — 단어이해(word)에만 값이 있다.
   *
   *  - semantic      같은 의미 범주 오답('사과'에 대한 '바나나')
   *  - phonological  소리가 닮은 다른 범주 오답('사과'에 대한 '사자')
   *  - unrelated     둘 다 아닌 오답
   *
   * 의미 오답을 반복해 고르는 것과 음운 오답을 반복해 고르는 것은 서로 다른
   * 손상이다. 정답률 하나로는 구분되지 않아 이 컬럼이 필요하다.
   *
   * **NULL이 정상이다** — 맞힌 문항, 단어이해가 아닌 하위검사, 컬럼 이전의 옛 행.
   * 집계는 NULL을 세지 않는다. 기본값을 채워 "모름"을 "무관"으로 바꾸면 없는
   * 사실이 생긴다.
   *
   * **채점에 쓰지 않는다.** 정확도·레벨 재계산은 이 값을 보지 않는다. 낱말 뱅크가
   * 프론트에 있어 서버가 되짚을 수 없는 클라이언트 관측값이라, 측정에 물리면
   * 안 된다(presented_level은 서버가 확정하는 것과 대비된다).
   */
  @Column({ name: 'foil_kind', type: 'varchar', length: 16, nullable: true })
  foilKind: QabFoilKind | null;

  // ddk 감지 횟수 등 수치 지표(없으면 null)
  @Column({ name: 'metric', type: 'int', nullable: true })
  metric: number | null;

  // 발음 정확도 점수(0~100). 따라말하기/읽기 등 발화 항목만 기록(그 외 null).
  // 보호자용 발음 추세 집계에 사용한다.
  @Column({ name: 'score', type: 'int', nullable: true })
  score: number | null;

  // 이 항목이 제시된 난이도 레벨(1~5). 적응형 레벨링의 윈도우를 "현재 레벨에서
  // 제시된 항목"으로 한정해 능력과 제시 난이도의 교란을 막는다. 컬럼 추가 이전
  // 구데이터는 null(레벨링 윈도우에서 제외).
  @Column({ name: 'presented_level', type: 'smallint', nullable: true })
  presentedLevel: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
