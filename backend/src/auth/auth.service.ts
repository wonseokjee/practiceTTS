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
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  buildPatientPlaceholderEmail,
  PATIENT_MODE_PIN_MAX_DELAY_MS,
  PATIENT_MODE_PIN_RETRY_DELAYS_MS,
  UNUSABLE_PASSWORD_HASH,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';

// JWT payload 타입 정의
export interface JwtPayload {
  sub: string; // userId
  email: string;
}

// 비밀번호/PIN 해시 및 자기참조 관계 제외 응답 타입
export type UserResponse = Omit<
  User,
  'passwordHash' | 'patient' | 'patientModePinHash'
>;

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
        const repo = manager.getRepository(User);

        // 1) 환자 레코드 (로그인 불가: placeholder email + sentinel passwordHash).
        //    id를 앱에서 미리 생성해 placeholder email을 단일 save로 확정한다
        //    (빈 email 선저장 시 동시 가입 UNIQUE('') 충돌 방지).
        const patientId = randomUUID();
        const patient = repo.create({
          id: patientId,
          email: buildPatientPlaceholderEmail(patientId),
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role: 'patient',
          displayName: dto.patientDisplayName,
          patientId: null,
          patientModePinHash: null,
        });
        await repo.save(patient);

        // 2) 보호자 레코드 (환자 연결 + PIN 해시)
        const caregiver = repo.create({
          email: dto.email,
          passwordHash,
          role: 'caregiver',
          displayName: dto.displayName,
          patientId,
          patientModePinHash,
        });
        return repo.save(caregiver);
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

  /** 로그인 가능한 계정인가 (환자/무비번 sentinel 차단) */
  private canLogin(user: User): boolean {
    if (user.role === 'patient') return false;
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
    return response;
  }
}
