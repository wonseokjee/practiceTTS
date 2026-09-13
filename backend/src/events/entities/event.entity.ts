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

/**
 * 범용 이벤트 1행 — "누가 언제 무엇을 했나(또는 봤나)"의 최소 형태.
 *
 * 기존 5개 테이블이 쓰기 행동을 이미 남기는 것과 달리, 이 테이블은 **열람**
 * (`@TrackView`, 서버가 GET 성공 후 기록)과 향후 프론트 상호작용 이벤트를 담는다
 * (영어판 실행 계획 §13-4의 1, M31).
 *
 * `event_name`은 스키마가 아니라 `event-registry.ts`가 검증한다.
 * `gstack-shortcut(dec-5e12e08e)`: 이벤트 이름을 CHECK 제약이 아니라 애플리케이션
 * 레지스트리로만 검증하는 지름길이다 — 지금은 이벤트 종류가 3개뿐이라 DB 제약의
 * 이점보다 마이그레이션 없는 확장이 더 크다. upgrade when: 이벤트 종류가 늘어
 * 목록 관리가 부담되거나, 이 테이블에 쓰는 서비스가 `EventsService.record()`
 * 바깥에서 하나라도 생기면(DB 레벨 보장이 실제로 필요해진다) CHECK 제약으로 승격.
 *
 * `payload`의 키도 스키마가 아니라 레지스트리가 검증한다 — `ValidationPipe`의
 * `whitelist`는 DTO 최상위 필드만 보고 이 jsonb 안쪽은 안 보기 때문이다
 * (계획 §13-4의 3-1).
 */
@Entity('events')
@Index('IDX_events_user_created', ['userId', 'createdAt'])
export class AppEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_events_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 레지스트리(`EVENT_REGISTRY`)에 등록된 이름만 실제로 저장된다. */
  @Column({ name: 'event_name', type: 'varchar', length: 64 })
  eventName: string;

  /** 이벤트 이름별 허용 키만 담는다(레지스트리가 그 외 키를 거부한다). */
  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
