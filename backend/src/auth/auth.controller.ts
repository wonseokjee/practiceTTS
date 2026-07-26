import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { IsString, Matches } from 'class-validator';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService, UserResponse } from './auth.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from './entities/user.entity';
import { SocialInitiateGuard, verifyOAuthState } from './oauth-state';
import { SocialAuthExceptionFilter } from './social-auth-exception.filter';
import type { SocialProfile } from './social-profile';

/** 환자 모드 복귀 PIN 검증 요청 DTO */
class VerifyPinDto {
  @IsString()
  @Matches(/^[0-9]{4}$/, { message: 'PIN은 4자리 숫자여야 합니다.' })
  pin: string;
}

/** 소셜 콜백 일회용 코드 → JWT 교환 DTO */
class TokenExchangeDto {
  @IsString()
  code: string;
}

// JWT 인증 후 Request에 주입되는 사용자 타입
interface AuthenticatedRequest {
  user: User;
}

// 소셜 전략(KakaoStrategy.validate)이 주입한 프로필
interface SocialRequest {
  user: SocialProfile;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

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

  // ─── 소셜 로그인(카카오) ────────────────────────────────────────

  // GET /auth/kakao - 카카오 인가 페이지로 리다이렉트. 가드가 CSRF state를
  // 발급(쿠키+URL)한다. 본문 없음.
  @Get('kakao')
  @UseGuards(SocialInitiateGuard('kakao'))
  kakaoAuth(): void {
    // 가드가 302 리다이렉트를 수행하므로 여기 도달하지 않는다.
  }

  // GET /auth/kakao/callback - 카카오 콜백. state 대조(CSRF) 후 유저 조회·생성,
  // 일회용 코드로 프론트에 리다이렉트한다(JWT를 URL에 직접 노출하지 않음).
  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  @UseFilters(SocialAuthExceptionFilter)
  async kakaoCallback(
    @Req() req: ExpressRequest & SocialRequest,
    @Res() res: Response,
  ): Promise<void> {
    verifyOAuthState(req, res, 'kakao');
    const code = await this.authService.socialLoginToCode(req.user);
    const frontend =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    // 코드를 쿼리(?)가 아니라 프래그먼트(#)로 전달한다. 프래그먼트는 서버로
    // 전송되지 않아(액세스 로그·Referer에 안 남음) 단명 코드의 유출면을 줄인다.
    res.redirect(`${frontend}/auth/callback#code=${encodeURIComponent(code)}`);
  }

  // ─── 소셜 로그인(구글) ─────────────────────────────────────────
  // 카카오와 동일 구조. 콜백은 공통 socialLoginToCode/일회용 코드를 재사용한다.

  @Get('google')
  @UseGuards(SocialInitiateGuard('google'))
  googleAuth(): void {
    // 가드가 구글 인가 페이지로 302 리다이렉트(+ CSRF state 발급).
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @UseFilters(SocialAuthExceptionFilter)
  async googleCallback(
    @Req() req: ExpressRequest & SocialRequest,
    @Res() res: Response,
  ): Promise<void> {
    verifyOAuthState(req, res, 'google');
    const code = await this.authService.socialLoginToCode(req.user);
    const frontend =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    // 코드를 쿼리(?)가 아니라 프래그먼트(#)로 전달한다. 프래그먼트는 서버로
    // 전송되지 않아(액세스 로그·Referer에 안 남음) 단명 코드의 유출면을 줄인다.
    res.redirect(`${frontend}/auth/callback#code=${encodeURIComponent(code)}`);
  }

  // POST /auth/token - 일회용 코드를 실제 JWT + user로 교환(1회 소비).
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async exchangeToken(
    @Body() dto: TokenExchangeDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    return this.authService.redeemOneTimeCode(dto.code);
  }

  // POST /auth/complete-onboarding - 소셜 최초 로그인 후 어르신 성함·PIN 입력.
  @Post('complete-onboarding')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CompleteOnboardingDto,
  ): Promise<UserResponse> {
    return this.authService.completeOnboarding(req.user.id, dto);
  }
}
