import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { AuthService, UserResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from './entities/user.entity';

/** 환자 모드 복귀 PIN 검증 요청 DTO */
class VerifyPinDto {
  @IsString()
  @Matches(/^[0-9]{4}$/, { message: 'PIN은 4자리 숫자여야 합니다.' })
  pin: string;
}

// JWT 인증 후 Request에 주입되는 사용자 타입
interface AuthenticatedRequest {
  user: User;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register - 회원가입
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    return this.authService.register(dto);
  }

  // POST /auth/login - 로그인
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    return this.authService.login(dto);
  }

  // GET /auth/me - 현재 로그인한 사용자 정보 조회
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: AuthenticatedRequest): Promise<UserResponse> {
    return this.authService.getMe(req.user.id);
  }

  // POST /auth/patient-mode/verify-pin - 환자 모드 → 보호자 복귀 PIN 검증
  @Post('patient-mode/verify-pin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async verifyPatientModePin(
    @Request() req: AuthenticatedRequest,
    @Body() dto: VerifyPinDto,
  ): Promise<{ ok: true }> {
    await this.authService.verifyPatientModePin(req.user.id, dto.pin);
    return { ok: true };
  }
}
