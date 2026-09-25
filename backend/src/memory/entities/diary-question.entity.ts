import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 일기 질문 풀 (정적 질문 카탈로그)
 * - scope: 'caregiver' = 보호자 본인 회고용, 'patient' = 환자에 관한 답변 유도용
 * - scope='patient'일 때는 category가 NOT NULL이어야 한다 (애플리케이션 레벨 검증)
 * - is_active=false 인 질문은 추출 풀에서 제외 (soft-delete)
 * - id 대신 (scope, text) 조합이 멱등 시드의 안정 키로 사용된다
 */
@Entity('diary_questions')
@Index('IDX_diary_questions_scope_cat_active', [
  'locale',
  'scope',
  'category',
  'isActive',
])
export class DiaryQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 노출 대상 로케일(users.locale과 같은 값). 기존 행은 전부 ko-KR
  @Column({ type: 'varchar', length: 8, default: 'ko-KR' })
  locale: string;

  // 'caregiver' | 'patient' — VARCHAR(16), 애플리케이션 레벨 enum 검증
  @Column({ type: 'varchar', length: 16 })
  scope: 'caregiver' | 'patient';

  // 'activity' | 'moment' | 'context' — scope='patient'일 때만 NOT NULL
  @Column({ type: 'varchar', length: 16, nullable: true })
  category: 'activity' | 'moment' | 'context' | null;

  // 질문 본문 (최대 200자)
  @Column({ type: 'varchar', length: 200 })
  text: string;

  // 비활성 질문은 추출에서 제외
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // UI 정렬 힌트 (랜덤 추출의 가중치는 미사용, 추후 정책 도입 여지)
  @Column({ name: 'order_hint', type: 'smallint', default: 0 })
  orderHint: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
