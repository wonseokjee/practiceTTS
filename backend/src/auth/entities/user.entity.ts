import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 사용자 역할 정의
export type UserRole = 'caregiver' | 'patient' | 'therapist';

// 로그인 제공자. 'local'=이메일/비밀번호, 그 외=소셜.
export type AuthProvider = 'local' | 'kakao' | 'google';

// (provider, provider_user_id) 부분 고유 인덱스. 마이그레이션(M13)과 동일하게
// 엔티티에도 선언해야 dev synchronize와 prod 마이그레이션이 어긋나지 않는다.
// 이 인덱스가 findOrCreateSocialUser의 동시 최초 로그인 경합 방어를 받친다.
@Index('UQ_users_provider_account', ['authProvider', 'providerUserId'], {
  unique: true,
  where: '"provider_user_id" IS NOT NULL',
})
// week_start의 허용 범위를 DB에서도 지킨다. 위 인덱스와 같은 규율 —
// 마이그레이션(M27)과 엔티티 양쪽에 선언해야 스키마가 어긋나지 않는다.
@Check('CHK_users_week_start', '"week_start" BETWEEN 0 AND 6')
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 소셜 로그인은 이메일을 안 줄 수 있어(카카오는 동의 선택) nullable.
  // NULL은 Postgres UNIQUE에 걸리지 않아 이메일 없는 소셜 유저가 공존한다.
  @Column({ unique: true, nullable: true, type: 'varchar' })
  email: string | null;

  // 비밀번호 해시는 기본적으로 조회 제외 (보안). 소셜 유저는 없음(NULL).
  @Column({
    name: 'password_hash',
    select: false,
    type: 'varchar',
    nullable: true,
  })
  passwordHash: string | null;

  // 로그인 제공자. 기존 계정은 마이그레이션 기본값 'local'.
  @Column({
    name: 'auth_provider',
    type: 'varchar',
    length: 20,
    default: 'local',
  })
  authProvider: AuthProvider;

  // 소셜 제공자가 준 그 계정의 고유 ID(카카오 회원번호 등). 재방문 매칭 키.
  // (auth_provider, provider_user_id)에 부분 고유 인덱스.
  @Column({ name: 'provider_user_id', type: 'varchar', nullable: true })
  providerUserId: string | null;

  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @Column({ name: 'display_name' })
  displayName: string;

  // 보호자(caregiver)가 연결된 환자의 ID (nullable)
  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  // 연결된 환자 엔티티 참조 (자기 참조 관계)
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_users_patient',
  })
  patient: User | null;

  // 환자 모드 복귀 PIN 해시 (보호자에만 설정). bcrypt 해시, 기본 조회 제외(보안).
  // 보호자 단일 계정 모델: 환자 모드에서 보호자로 돌아올 때 4자리 PIN 검증.
  @Column({
    name: 'patient_mode_pin_hash',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  patientModePinHash: string | null;

  /**
   * 이 사용자가 읽고 듣는 언어 (BCP 47, 예: `ko-KR`·`en-US`).
   *
   * 보호자와 환자가 **각각 독립된 users 행**이라, 계획서의
   * `patient_locale`/`caregiver_locale` 두 값이 여기서는 한 컬럼이 두 행에
   * 담기는 모양이 된다. 보호자가 환자를 둘 돌봐도 보호자 로케일은 하나다.
   *
   * 환자 행의 값이 문항·TTS·채점기를 정하고, 보호자 행의 값이 대시보드·주간
   * 리포트를 정한다.
   */
  @Column({ name: 'locale', type: 'varchar', length: 8, default: 'ko-KR' })
  locale: string;

  /**
   * IANA 타임존 이름 (예: `Asia/Seoul`·`America/Los_Angeles`).
   *
   * **환자 행의 값만 쓴다** — 이건 언어가 아니라 집계 축이라, 환자·보호자로
   * 나누면 같은 데이터가 두 가지로 집계된다.
   *
   * 오프셋(+09:00)이 아니라 이름을 담는 이유는 서머타임이다. 미국은 오프셋이
   * 해마다 두 번 바뀌어, 오프셋을 얼리면 그 경계에서 하루가 어긋난다.
   */
  @Column({
    name: 'timezone',
    type: 'varchar',
    length: 64,
    default: 'Asia/Seoul',
  })
  timezone: string;

  /**
   * 주 시작 요일. **0=일요일 … 6=토요일** — JS `Date#getDay()`·Postgres
   * `EXTRACT(DOW)`와 같은 축이다. ISO(`EXTRACT(ISODOW)`, 1=월요일)와 헷갈리기
   * 쉬우니 이 주석을 지우지 말 것.
   *
   * 기본 1(월요일)은 현재 동작 그대로다. 미국은 일요일 시작이 관습이라
   * 로케일이 생기면 갈리는데, **로케일에서 파생시키지 않는다** — `en-US`라도
   * 월요일 시작을 원할 수 있고, 집계가 서버에서 일어나므로 서버가 이 값을
   * 알아야 한다.
   */
  @Column({ name: 'week_start', type: 'smallint', default: 1 })
  weekStart: number;

  // 음성 데이터 보존 동의(opt-in). 자체 ASR 학습을 위해 환자 발화를 보존할지 여부.
  // 미동의(기본)면 발화는 채점 후 즉시 폐기된다. 보호자가 설정에서 켜고 끌 수 있다.
  @Column({ name: 'speech_data_consent', type: 'boolean', default: false })
  speechDataConsent: boolean;

  // 동의 시각(철회 시 NULL). 컴플라이언스 기록용.
  @Column({
    name: 'speech_data_consent_at',
    type: 'timestamptz',
    nullable: true,
  })
  speechDataConsentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
