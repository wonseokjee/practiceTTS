import {
  ConflictException,
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
  'passwordHash' | 'patient' | 'patientModePinHash'
> & {
  patientDisplayName: string | null;
  // 소셜 최초 로그인 후 어르신 성함·PIN 미입력 상태. 프론트가 온보딩으로 라우팅.
  needsOnboarding: boolean;
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

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

    return this.toUserResponse(user);
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
   * (provider, providerUserId)로 유저를 찾고, 없으면 미완성 소셜 유저를 만든다.
   *  - 신규 유저는 patient_id=null → needsOnboarding=true(어르신 성함·PIN 미입력).
   *  - 이메일이 이미 다른 계정에 있으면 자동 병합하지 않고 email=null로 생성.
   */
  async findOrCreateSocialUser(profile: SocialProfile): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: {
        authProvider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });
    if (existing) return existing;

    // 이메일 충돌: 기존 계정이 이 이메일을 쓰면 병합하지 않고 email 없이 만든다.
    let email = profile.email;
    if (email) {
      const taken = await this.userRepository.findOne({ where: { email } });
      if (taken) email = null;
    }

    const user = this.userRepository.create({
      email,
      passwordHash: null,
      role: 'caregiver',
      displayName: profile.displayName,
      patientId: null, // 온보딩 필요
      patientModePinHash: null,
      authProvider: profile.provider,
      providerUserId: profile.providerUserId,
    });

    try {
      return await this.userRepository.save(user);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        // (1) 동시 최초 로그인 경합: 부분 고유 인덱스 위반 → 방금 만들어진 행을 재조회.
        const again = await this.userRepository.findOne({
          where: {
            authProvider: profile.provider,
            providerUserId: profile.providerUserId,
          },
        });
        if (again) return again;
        // (2) 그게 아니면 이메일 UNIQUE 경합: 사전 체크 이후 다른 계정이 이 이메일을
        //     선점했다. email 없이 1회 재시도(이메일은 부가 정보라 비워도 로그인 가능).
        if (user.email !== null) {
          user.email = null;
          return await this.userRepository.save(user);
        }
      }
      throw err;
    }
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
    return {
      accessToken: this.issueToken(user),
      user: this.toUserResponse(user),
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
    if (user.patientId !== null) {
      throw new ConflictException('이미 온보딩이 완료되었습니다.');
    }

    const patientModePinHash = await bcrypt.hash(dto.patientModePin, 10);
    const updated = await this.dataSource.transaction(async (manager) => {
      const patientId = await this.createPatientRecord(
        manager,
        dto.patientDisplayName,
      );
      const repo = manager.getRepository(User);
      await repo.update(userId, { patientId, patientModePinHash });
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
  private toUserResponse(user: User): UserResponse {
    const {
      passwordHash: _pw,
      patient: _patient,
      patientModePinHash: _pin,
      ...response
    } = user;
    // 환자 관계가 로드된 경우(getMe)에만 환자 성함을 노출, 아니면 null.
    return {
      ...response,
      patientDisplayName: _patient?.displayName ?? null,
      // 보호자인데 아직 연결된 환자가 없으면 온보딩 필요(소셜 최초 로그인).
      needsOnboarding: user.role === 'caregiver' && user.patientId === null,
    };
  }
}
