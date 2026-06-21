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
export class QabResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
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

  // ddk 감지 횟수 등 수치 지표(없으면 null)
  @Column({ name: 'metric', type: 'int', nullable: true })
  metric: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
