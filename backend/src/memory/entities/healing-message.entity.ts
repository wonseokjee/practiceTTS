import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 매일 치유 메시지 풀 (Pattern 2, 정적 카탈로그)
 * - 환자/보호자 대시보드 상단 "오늘의 메시지"로 노출
 * - 날짜 기반 결정적 회전(서비스 레이어)으로 매일 1개 선택
 * - is_active=false 는 회전 풀에서 제외 (soft-delete)
 * - 멱등 시드 안정 키: text
 */
@Entity('healing_messages')
@Index('IDX_healing_messages_active', ['isActive'])
export class HealingMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 메시지 본문 (최대 300자)
  @Column({ type: 'varchar', length: 300 })
  text: string;

  // 비활성 메시지는 회전 풀에서 제외
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // 회전 순서 안정화용 (시드 입력 순서)
  @Column({ name: 'order_index', type: 'smallint', default: 0 })
  orderIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
