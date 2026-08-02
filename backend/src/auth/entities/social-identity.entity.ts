import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthProvider, User } from './user.entity';

/** 소셜 로그인 수단(카카오·구글). 'local'은 identity로 관리하지 않는다. */
export type SocialProviderName = Exclude<AuthProvider, 'local'>;

/**
 * 유저 ↔ 소셜 로그인 수단의 연결(계정 병합의 근간).
 *
 * users는 auth_provider/provider_user_id를 각 1개만 갖는다("최초/주 provider").
 * 계정 병합은 "유저 1명 ↔ 로그인 수단 여러 개"라, 로그인 조회의 실제 근거를
 * 이 테이블로 옮긴다. 재방문 로그인은 (provider, provider_user_id)로 이 테이블을
 * 찾고, 없으면 자동 연결(검증 이메일 일치) 또는 신규 계정 생성으로 간다.
 */
@Index('UQ_social_identity_provider_account', ['provider', 'providerUserId'], {
  unique: true,
})
// 한 유저가 같은 provider를 둘 이상 붙이지 못하게(카카오 1 + 구글 1 상한).
@Index('UQ_social_identity_user_provider', ['userId', 'provider'], {
  unique: true,
})
@Entity('user_social_identities')
export class SocialIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // 유저 삭제 시 연결도 함께 삭제(CASCADE). 소셜계정만 남는 고아 방지.
  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_social_identity_user',
  })
  user: User;

  @Column({ type: 'varchar', length: 20 })
  provider: SocialProviderName;

  // 소셜 제공자 계정 고유 ID(카카오 회원번호 등). (provider, id)로 재방문 매칭.
  @Column({ name: 'provider_user_id', type: 'varchar' })
  providerUserId: string;

  // 연결 시점 provider가 준 이메일(참고용). 로그인 매칭 키가 아니다.
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
