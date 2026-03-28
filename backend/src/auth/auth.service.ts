import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';

// JWT payload 타입 정의
export interface JwtPayload {
  sub: string; // userId
  email: string;
}

// 비밀번호 제외 응답 타입
export type UserResponse = Omit<User, 'passwordHash' | 'patient'>;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  // 회원가입: 이메일 중복 확인 후 비밀번호 해시화하여 저장
  async register(dto: RegisterDto): Promise<{ accessToken: string; user: UserResponse }> {
    const exists = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (exists) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }

    // bcrypt 솔트 라운드 10 적용
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = this.userRepository.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      displayName: dto.displayName,
      patientId: dto.patientId ?? null,
    });

    const saved = await this.userRepository.save(user);
    const accessToken = this.issueToken(saved);

    return {
      accessToken,
      user: this.toUserResponse(saved),
    };
  }

  // 로그인: 이메일/비밀번호 검증 후 JWT 발급
  async login(dto: LoginDto): Promise<{ accessToken: string; user: UserResponse }> {
    // passwordHash 필드가 select: false이므로 명시적으로 포함 조회
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
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

  // JWT 토큰 발급
  private issueToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwtService.sign(payload);
  }

  // 응답에서 민감 정보(passwordHash) 제거
  private toUserResponse(user: User): UserResponse {
    const { passwordHash: _, patient: __, ...response } = user;
    return response;
  }
}
