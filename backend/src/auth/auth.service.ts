import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  DataSource,
  EntityManager,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  buildPatientPlaceholderEmail,
  PATIENT_MODE_PIN_MAX_DELAY_MS,
  PATIENT_MODE_PIN_RETRY_DELAYS_MS,
  UNUSABLE_PASSWORD_HASH,
} from './auth.constants';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';
import {
  SocialIdentity,
  SocialProviderName,
} from './entities/social-identity.entity';
import type { SocialProfile } from './social-profile';

// JWT payload 타입 정의
export interface JwtPayload {
  sub: string; // userId
  // 소셜 유저는 이메일이 없을 수 있다. 검증은 sub만 쓰므로 정보용.
  email: string | null;
}

// 비밀번호/PIN 해시 및 자기참조 관계 제외 응답 타입
// patientDisplayName: 보호자가 돌보는 환자(어르신) 성함 — 환자 관계가 로드됐을 때만 채워지고,
// 아니면 null. 환자 모드 화면 인사말 등에 사용한다.
export type UserResponse = Omit<
  User,
  'passwordHash' | 'patient' | 'patientModePinHash' | 'providerUserId'
> & {
  patientDisplayName: string | null;
  // 소셜 최초 로그인 후 어르신 성함·PIN 미입력 상태. 프론트가 온보딩으로 라우팅.
  needsOnboarding: boolean;
  // 이 계정에 연결된 소셜 제공자 목록(계정 병합). 설정 화면의 "연결된 계정"에 표시.
  // 신원 조회가 필요한 응답(getMe·소셜 로그인)에서만 채우고, 그 외엔 빈 배열.
  linkedProviders: SocialProviderName[];
};

/** PIN 검증 시도 추적 (in-memory, 점증 디레이용) */
interface PinAttemptState {
  fails: number;
  nextAllowedAt: number;
}

@Injectable()
export class AuthService {
  /**
   * verify-pin 점증 디레이 추적 (단일 인스턴스 가정 — 운영 다중화 시 공유 저장소 필요).
   * userId → 누적 실패 횟수 + 다음 시도 허용 시각.
   */
  private readonly pinAttempts = new Map<string, PinAttemptState>();

  /**
   * 소셜 콜백 → 프론트 전달용 일회용 코드 저장소.
   * JWT를 리다이렉트 URL에 직접 노출하지 않으려고, 콜백은 단명 코드만 넘기고
   * 프론트가 POST /auth/token으로 교환한다(단일 인스턴스 가정 — pinAttempts와 동일).
   */
  private readonly oneTimeCodes = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  private static readonly ONE_TIME_CODE_TTL_MS = 60_000;

  /**
   * 소셜 계정 "수동 연결" 시작용 단명 코드 저장소(계정 병합 2단계).
   * 로그인 상태에서 발급하고, 브라우저가 GET /auth/:provider/link?code=로 넘긴다.
   * 링크 시작 라우트는 이 코드를 쿠키로 옮겨 콜백까지 나르고, 콜백이 1회 소비한다
   * (단일 인스턴스 가정 — oneTimeCodes와 동일).
   */
  private readonly linkCodes = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  private static readonly LINK_CODE_TTL_MS = 120_000;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SocialIdentity)
    private readonly identityRepository: Repository<SocialIdentity>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 보호자 회원가입 — 보호자 + 환자(로그인 불가) 레코드를 단일 트랜잭션으로 생성.
   *
   * 원자성: email 사전 검사 대신 두 행을 한 트랜잭션에서 INSERT하고, email UNIQUE
   * 제약 위반(23505)을 catch해 409로 변환한다. 동시 가입 경합에도 통째 롤백되어
   * orphan 환자 레코드가 남지 않는다.
   */
  async register(
    dto: RegisterDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const patientModePinHash = await bcrypt.hash(dto.patientModePin, 10);

    let savedCaregiver: User;
    try {
      savedCaregiver = await this.dataSource.transaction(async (manager) => {
        // 1) 환자 레코드 (로그인 불가). 온보딩과 공유하는 헬퍼.
        const patientId = await this.createPatientRecord(
          manager,
          dto.patientDisplayName,
        );

        // 2) 보호자 레코드 (환자 연결 + PIN 해시)
        const caregiver = manager.getRepository(User).create({
          email: dto.email,
          passwordHash,
          role: 'caregiver',
          displayName: dto.displayName,
          patientId,
          patientModePinHash,
        });
        return manager.getRepository(User).save(caregiver);
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('이미 사용 중인 이메일입니다.');
      }
      throw err;
    }

    const accessToken = this.issueToken(savedCaregiver);
    return {
      accessToken,
      user: this.toUserResponse(savedCaregiver),
    };
  }

  // 로그인: 이메일/비밀번호 검증 후 JWT 발급
  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    // passwordHash 필드가 select: false이므로 명시적으로 포함 조회
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    // 로그인 불가 계정(환자/무비번 sentinel)은 bcrypt 비교 전에 명시적으로 거부.
    // bcrypt가 비정상 해시에 대해 throw하여 500이 되는 것을 방지(explicit > clever).
    if (!this.canLogin(user)) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    // canLogin이 null·sentinel을 이미 거른다. 타입 좁히기용 방어.
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    const accessToken = this.issueToken(user);
    return {
      accessToken,
      user: this.toUserResponse(user),
    };
  }

  // JWT payload 검증 후 사용자 반환 (JwtStrategy에서 호출)
  async validateUser(payload: JwtPayload): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }

    return user;
  }

  // 현재 로그인한 사용자 정보 반환
  async getMe(userId: string): Promise<UserResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      // 환자 모드 인사말 등에 쓰도록 연결된 환자(어르신) 정보를 함께 로드한다.
      relations: { patient: true },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const linkedProviders = await this.listLinkedProviders(userId);
    return this.toUserResponse(user, linkedProviders);
  }

  /**
   * 환자 모드 → 보호자 복귀 PIN 검증.
   *
   * 점증 디레이(잠금 없음): 연속 실패 시 다음 시도까지 대기를 강제(백엔드)하여
   * devtools 우회 불가. 성공 시 시도 카운터 리셋.
   *
   * @throws 429 디레이 중 재시도, 401 PIN 불일치, 400 PIN 미설정
   */
  async verifyPatientModePin(userId: string, pin: string): Promise<void> {
    const now = Date.now();
    const state = this.pinAttempts.get(userId);
    if (state && now < state.nextAllowedAt) {
      const retryAfterSec = Math.ceil((state.nextAllowedAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `잠시 후 다시 시도해주세요. (${retryAfterSec}초)`,
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.patientModePinHash')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user || !user.patientModePinHash) {
      // PIN 미설정 계정(환자 등) — 검증 대상 아님
      throw new UnauthorizedException('PIN이 설정되어 있지 않습니다.');
    }

    const ok = await bcrypt.compare(pin, user.patientModePinHash);
    if (!ok) {
      this.registerPinFailure(userId, now);
      throw new UnauthorizedException('PIN이 일치하지 않습니다.');
    }

    this.pinAttempts.delete(userId);
  }

  /** 실패 1회 기록 + 다음 허용 시각 갱신 (점증 디레이) */
  private registerPinFailure(userId: string, now: number): void {
    const prev = this.pinAttempts.get(userId);
    const fails = (prev?.fails ?? 0) + 1;
    const delay =
      PATIENT_MODE_PIN_RETRY_DELAYS_MS[fails] ?? PATIENT_MODE_PIN_MAX_DELAY_MS;
    this.pinAttempts.set(userId, { fails, nextAllowedAt: now + delay });
  }

  // ─── 소셜 로그인 ───────────────────────────────────────────────

  /**
   * 소셜 콜백 진입점: 프로필로 유저를 조회·생성하고, 프론트에 넘길 일회용 코드를 발급.
   * 컨트롤러는 이 코드를 FRONTEND_URL/auth/callback?code=... 로 리다이렉트한다.
   */
  async socialLoginToCode(profile: SocialProfile): Promise<string> {
    const user = await this.findOrCreateSocialUser(profile);
    return this.issueOneTimeCode(user.id);
  }

  /**
   * 소셜 프로필 → 유저 해석(계정 병합 1단계, 자동 연결).
   *
   *  1) (provider, providerUserId) identity가 있으면 그 유저로 재방문 로그인.
   *  2) 없으면: **검증된 이메일**이 기존 (환자 아님) 계정과 일치하면 그 계정에
   *     identity를 붙여 합류(자동 연결). 실수로 다른 provider를 눌러 빈 계정이
   *     생기는 것을 막는다.
   *  3) 그마저 없으면 patient_id=null 미완성 보호자를 새로 만든다(온보딩 필요).
   *
   * 자동 연결은 검증 이메일에만 허용한다 — 미검증 이메일로 붙이면 남의 계정을
   * 탈취할 수 있다. 이메일이 없거나 다르면 자동 연결은 불가하고, 이 경우는
   * 2단계(설정에서 수동 연결)로 커버한다.
   */
  async findOrCreateSocialUser(profile: SocialProfile): Promise<User> {
    const existing = await this.findIdentityUser(
      this.identityRepository,
      profile,
    );
    if (existing) return existing;

    // 신규 신원: 유저 생성/자동연결 + identity 생성을 한 트랜잭션으로 묶는다.
    // 유니크 경합이 나면 트랜잭션 전체가 롤백되므로(고아 없음), 트랜잭션 밖에서
    // 원인을 갈라 처리한다. Postgres는 트랜잭션 내 첫 에러 이후 그 트랜잭션의
    // 모든 쿼리를 거부하므로, 재조회·재시도는 반드시 트랜잭션 밖에서 한다.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.dataSource.transaction((manager) =>
          this.attachOrCreateForSocial(manager, profile),
        );
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
        // (a) provider-id 경합: 다른 요청이 같은 소셜계정을 먼저 연결함 → 그 유저.
        const again = await this.findIdentityUser(
          this.identityRepository,
          profile,
        );
        if (again) return again;
        // (b) email 경합: 사전체크 이후 이 이메일을 선점당함. 재시도하면 이번엔
        //     사전체크가 taken을 보고 email=null로 만든다. 마지막 시도면 rethrow.
        if (attempt === 1) throw err;
      }
    }
    // 루프는 반환/throw로만 끝난다. 타입 만족용.
    throw new Error('unreachable');
  }

  /** (provider, providerUserId) identity로 연결된 유저를 찾는다(없으면 null). */
  private async findIdentityUser(
    repo: Repository<SocialIdentity>,
    profile: SocialProfile,
  ): Promise<User | null> {
    const identity = await repo.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
      relations: { user: true },
    });
    return identity?.user ?? null;
  }

  /**
   * (트랜잭션 내) 신규 소셜 신원을 유저에 연결한다 — 자동 연결 또는 신규 생성.
   * 유니크 경합은 여기서 잡지 않는다. 트랜잭션을 롤백시키고 호출부가 처리한다.
   */
  private async attachOrCreateForSocial(
    manager: EntityManager,
    profile: SocialProfile,
  ): Promise<User> {
    const userRepo = manager.getRepository(User);
    const idRepo = manager.getRepository(SocialIdentity);

    // 트랜잭션 시작 직전 다른 요청이 같은 identity를 만들었을 수 있다(경합) → 재확인.
    const raced = await this.findIdentityUser(idRepo, profile);
    if (raced) return raced;

    // 자동 연결 대상: 검증된 이메일이 기존 (환자 아님) 계정과 일치할 때만.
    let target: User | null = null;
    if (profile.email && profile.emailVerified) {
      const byEmail = await userRepo.findOne({
        where: { email: profile.email },
      });
      // 환자 placeholder는 로그인 불가 레코드라 자동 연결 대상에서 제외한다.
      if (byEmail && byEmail.role !== 'patient') target = byEmail;
    }

    // 자동 연결 대상이 없으면 미완성 보호자 계정을 새로 만든다(온보딩 필요).
    if (!target) target = await this.createSocialUser(userRepo, profile);

    // 유저 ↔ 소셜 신원 연결. 유니크 위반은 밖에서 처리(트랜잭션 롤백).
    await idRepo.save(
      idRepo.create({
        userId: target.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
      }),
    );
    return target;
  }

  /**
   * (트랜잭션 내) 신규 소셜 보호자 레코드 생성. users.email은 UNIQUE라, 이미
   * 쓰이는 이메일(미검증이라 자동연결 못 한 경우 등)이면 비워 충돌을 피한다.
   * 사전체크 이후의 이메일 경합은 잡지 않고 트랜잭션을 롤백시킨다(호출부 재시도).
   */
  private async createSocialUser(
    userRepo: Repository<User>,
    profile: SocialProfile,
  ): Promise<User> {
    let email = profile.email;
    if (email) {
      const taken = await userRepo.findOne({ where: { email } });
      if (taken) email = null;
    }
    const user = userRepo.create({
      email,
      passwordHash: null,
      role: 'caregiver',
      displayName: profile.displayName,
      patientId: null, // 온보딩 필요
      patientModePinHash: null,
      // users의 auth_provider/provider_user_id는 "최초/주 provider" 표시용으로
      // 남긴다(로그인 조회의 근거는 identity 테이블). 신규 유저는 이 provider가 주.
      authProvider: profile.provider,
      providerUserId: profile.providerUserId,
    });
    return userRepo.save(user);
  }

  /** 일회용 코드 발급(단명). userId를 매핑해 둔다. */
  private issueOneTimeCode(userId: string): string {
    const now = Date.now();
    // 교환 없이 버려진 코드(사용자가 콜백 후 이탈)가 무한 누적되지 않게,
    // 발급할 때마다 만료된 항목을 청소한다. n은 TTL 창의 활동량으로 제한된다.
    for (const [existing, entry] of this.oneTimeCodes) {
      if (now > entry.expiresAt) this.oneTimeCodes.delete(existing);
    }
    const code = randomUUID();
    this.oneTimeCodes.set(code, {
      userId,
      expiresAt: now + AuthService.ONE_TIME_CODE_TTL_MS,
    });
    return code;
  }

  /** 일회용 코드 → 실제 JWT + user 교환(1회 소비). 만료/무효면 401. */
  async redeemOneTimeCode(
    code: string,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    const entry = this.oneTimeCodes.get(code);
    this.oneTimeCodes.delete(code); // 1회용: 조회 즉시 폐기
    if (!entry || Date.now() > entry.expiresAt) {
      throw new UnauthorizedException('만료되었거나 유효하지 않은 코드입니다.');
    }
    const user = await this.userRepository.findOne({
      where: { id: entry.userId },
      relations: { patient: true },
    });
    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }
    const linkedProviders = await this.listLinkedProviders(user.id);
    return {
      accessToken: this.issueToken(user),
      user: this.toUserResponse(user, linkedProviders),
    };
  }

  /**
   * 소셜 온보딩 완료: 어르신 성함 + PIN을 받아 환자 레코드를 만들고 연결한다.
   * 이미 연결된 환자가 있으면 409(중복 온보딩 방지).
   */
  async completeOnboarding(
    userId: string,
    dto: CompleteOnboardingDto,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    // 온보딩(환자 연결)은 보호자만. therapist 등 다른 역할이 patient_id=null이라고
    // 환자 레코드를 만들어 붙이지 못하게 막는다.
    if (user.role !== 'caregiver') {
      throw new ForbiddenException('보호자 계정만 온보딩할 수 있습니다.');
    }
    if (user.patientId !== null) {
      throw new ConflictException('이미 온보딩이 완료되었습니다.');
    }

    const patientModePinHash = await bcrypt.hash(dto.patientModePin, 10);
    const updated = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const patientId = await this.createPatientRecord(
        manager,
        dto.patientDisplayName,
      );
      // patient_id가 여전히 NULL일 때만 연결한다. 동시 온보딩(더블클릭·재시도)에서
      // 뒤늦은 요청은 0행 갱신 → 409로 롤백되어, 방금 만든 patient 행도 함께
      // 폐기된다(고아 행 방지). 트랜잭션 밖 사전 체크(위)는 흔한 경우의 빠른 거절용.
      const res = await repo.update(
        { id: userId, patientId: IsNull() },
        { patientId, patientModePinHash },
      );
      if (res.affected !== 1) {
        throw new ConflictException('이미 온보딩이 완료되었습니다.');
      }
      return repo.findOne({
        where: { id: userId },
        relations: { patient: true },
      });
    });

    return this.toUserResponse(updated!);
  }

  /**
   * 로그인 불가 환자 레코드 생성(placeholder email + sentinel password).
   * register와 온보딩이 공유. id를 미리 만들어 placeholder email을 단일 save로 확정.
   */
  private async createPatientRecord(
    manager: EntityManager,
    patientDisplayName: string,
  ): Promise<string> {
    const repo = manager.getRepository(User);
    const patientId = randomUUID();
    const patient = repo.create({
      id: patientId,
      email: buildPatientPlaceholderEmail(patientId),
      passwordHash: UNUSABLE_PASSWORD_HASH,
      role: 'patient',
      displayName: patientDisplayName,
      patientId: null,
      patientModePinHash: null,
      authProvider: 'local',
      providerUserId: null,
    });
    await repo.save(patient);
    return patientId;
  }

  /** 비밀번호 로그인 가능한 계정인가 (환자/무비번 sentinel/소셜 차단) */
  private canLogin(user: User): boolean {
    if (user.role === 'patient') return false;
    // 소셜 유저는 비밀번호가 없다(NULL). 비번 로그인 대상 아님.
    if (!user.passwordHash) return false;
    if (user.passwordHash === UNUSABLE_PASSWORD_HASH) return false;
    return true;
  }

  /** Postgres UNIQUE 제약 위반(23505) 여부 */
  private isUniqueViolation(err: unknown): boolean {
    if (err instanceof QueryFailedError) {
      const driverErr = err.driverError as { code?: string } | undefined;
      return driverErr?.code === '23505';
    }
    return false;
  }

  // JWT 토큰 발급
  private issueToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwtService.sign(payload);
  }

  // 응답에서 민감 정보(passwordHash, PIN 해시) 및 자기참조 관계 제거
  private toUserResponse(
    user: User,
    linkedProviders: SocialProviderName[] = [],
  ): UserResponse {
    const {
      passwordHash: _pw,
      patient: _patient,
      patientModePinHash: _pin,
      // 소셜 제공자 내부 식별자(카카오 회원번호 등)는 클라이언트에 노출하지 않는다.
      providerUserId: _providerUserId,
      ...response
    } = user;
    // 환자 관계가 로드된 경우(getMe)에만 환자 성함을 노출, 아니면 null.
    return {
      ...response,
      patientDisplayName: _patient?.displayName ?? null,
      // 보호자인데 아직 연결된 환자가 없으면 온보딩 필요(소셜 최초 로그인).
      needsOnboarding: user.role === 'caregiver' && user.patientId === null,
      linkedProviders,
    };
  }

  // ─── 소셜 계정 수동 연결(계정 병합 2단계) ─────────────────────

  /** 이 유저에 연결된 소셜 제공자 목록. */
  async listLinkedProviders(userId: string): Promise<SocialProviderName[]> {
    const rows = await this.identityRepository.find({ where: { userId } });
    return rows.map((r) => r.provider);
  }

  /** 수동 연결 시작 코드 발급(단명·1회용). 만료 항목은 발급 시 청소. */
  issueLinkCode(userId: string): string {
    const now = Date.now();
    for (const [existing, entry] of this.linkCodes) {
      if (now > entry.expiresAt) this.linkCodes.delete(existing);
    }
    const code = randomUUID();
    this.linkCodes.set(code, {
      userId,
      expiresAt: now + AuthService.LINK_CODE_TTL_MS,
    });
    return code;
  }

  /** 링크 코드 → userId 교환(1회 소비). 만료/무효면 null. */
  redeemLinkCode(code: string): string | null {
    const entry = this.linkCodes.get(code);
    this.linkCodes.delete(code); // 1회용: 조회 즉시 폐기
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.userId;
  }

  /**
   * 로그인된 유저에게 소셜 신원을 연결한다(콜백에서 호출).
   *  - 그 소셜계정이 이미 다른 유저에 연결돼 있으면 409(계정 탈취/오연결 방지).
   *  - 같은 유저에 이미 연결돼 있으면 멱등 성공.
   *  - 이 유저가 같은 provider를 이미 붙였으면 409(유저당 provider 1개).
   */
  async linkSocialIdentity(
    userId: string,
    profile: SocialProfile,
  ): Promise<void> {
    const existing = await this.identityRepository.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });
    if (existing) {
      if (existing.userId === userId) return; // 이미 연결됨(멱등)
      throw new ConflictException(
        '이미 다른 계정에 연결된 소셜 계정입니다.',
      );
    }
    const sameProvider = await this.identityRepository.findOne({
      where: { userId, provider: profile.provider },
    });
    if (sameProvider) {
      throw new ConflictException('이미 이 제공자가 연결되어 있습니다.');
    }
    try {
      await this.identityRepository.save(
        this.identityRepository.create({
          userId,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
        }),
      );
    } catch (err) {
      // 사전 체크 이후의 경합(유니크 위반)은 연결 충돌로 수렴.
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('이미 연결된 소셜 계정입니다.');
      }
      throw err;
    }
  }

  /**
   * 소셜 신원 연결 해제. 남은 로그인 수단이 0이 되면(소셜 전용 계정의 마지막
   * 신원) 계정이 로그인 불능이 되므로 막는다(403). users의 "주 provider"가 방금
   * 뺀 것을 가리키면 남은 신원(또는 로컬)으로 재지정해 무결성을 유지한다.
   *
   * @returns 해제 후 남은 연결 제공자 목록
   */
  async unlinkSocialIdentity(
    userId: string,
    provider: SocialProviderName,
  ): Promise<SocialProviderName[]> {
    const rows = await this.identityRepository.find({ where: { userId } });
    const target = rows.find((r) => r.provider === provider);
    if (!target) {
      throw new NotFoundException('연결되지 않은 제공자입니다.');
    }

    // 비밀번호로도 로그인 가능한 계정인가(로컬 가입 후 소셜 연결한 경우).
    const withHash = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    const hasPassword = withHash ? this.canLogin(withHash) : false;

    // 마지막 로그인 수단(비번 없음 + 소셜 신원 1개)은 해제 불가.
    if (rows.length === 1 && !hasPassword) {
      throw new ForbiddenException('마지막 로그인 수단은 해제할 수 없어요.');
    }

    const remaining = rows.filter((r) => r.provider !== provider);
    await this.dataSource.transaction(async (manager) => {
      const idRepo = manager.getRepository(SocialIdentity);
      const userRepo = manager.getRepository(User);
      await idRepo.delete({ userId, provider });

      // users의 주 provider가 방금 뺀 것을 가리키면 재지정(무결성·재로그인 대비).
      const fresh = await userRepo.findOne({ where: { id: userId } });
      if (fresh && fresh.authProvider === provider) {
        if (remaining.length > 0) {
          await userRepo.update(
            { id: userId },
            {
              authProvider: remaining[0].provider,
              providerUserId: remaining[0].providerUserId,
            },
          );
        } else {
          // 남은 소셜 신원이 없다(=비번 로그인 계정). 로컬로 되돌린다.
          await userRepo.update(
            { id: userId },
            { authProvider: 'local', providerUserId: null },
          );
        }
      }
    });

    return remaining.map((r) => r.provider);
  }
}
