import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

/**
 * 세션 완료 마커. session_token 하나당 1행만 존재하며, 존재 자체가 "이 세션이
 * 끝까지 진행됐다"는 뜻이다. qab_results에 행이 있는데 여기 없으면 중도 이탈
 * (완료 vs 중단 구분 — 보호자 대시보드 이탈/완료율 통계용).
 *
 * 자연 종료(마지막 문항 도달)와 피로 탈출(안전장치 조기 종료) 모두 완료로
 * 본다 — 둘 다 세션이 의도한 대로 마무리된 것이지 이탈이 아니다. 화면 이탈
 * (언마운트) 시의 best-effort flush는 완료로 남기지 않는다.
 */
@Entity('qab_session_completions')
// M19가 만드는 인덱스. 엔티티에도 선언해야 스키마 드리프트가 안 생긴다.
@Index('IDX_qab_session_completions_patient', ['patientId'])
export class QabSessionCompletion {
  @PrimaryColumn({ name: 'session_token', type: 'uuid' })
  sessionToken: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_qab_session_completions_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 서비스가 항상 값을 넣지만 DB 기본값도 M19와 맞춘다(드리프트 방지 +
  // 직접 INSERT 시 안전망).
  @Column({ name: 'completed_at', type: 'timestamptz', default: () => 'now()' })
  completedAt: Date;
}
