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
@Index('UQ_qab_results_dedup', ['patientId', 'sessionToken', 'subtest', 'itemRef'], {
  unique: true,
})
export class QabResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id', foreignKeyConstraintName: 'FK_qab_results_patient' })
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
   * 채점 불가 — 음향 발음 평가를 얻지 못해 **판정을 내리지 않은** 문항.
   *
   * assisted와 다르다. assisted는 "보호자가 도와서 통과시켰다"(수행은 있었으나
   * 환자 혼자 한 것이 아니다)이고, unscored는 "**잴 수 없었다**"이다. 오답이
   * 아니라 측정 실패다.
   *
   * 이 행의 is_correct는 의미가 없다(false로 들어온다). 집계·레벨링은 반드시
   * 이 플래그로 걸러야 한다 — 아래 쿼리들이 그렇게 한다.
   */
  @Column({ name: 'unscored', type: 'boolean', default: false })
  unscored: boolean;

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
