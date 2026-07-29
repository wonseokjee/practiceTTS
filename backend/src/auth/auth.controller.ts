import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
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
import { SocialProviderName } from './entities/social-identity.entity';
import {
  LinkInitiateGuard,
  readLinkCode,
  SocialInitiateGuard,
  verifyOAuthState,
} from './oauth-state';
import { SocialAuthExceptionFilter } from './social-auth-exception.filter';
import type { SocialProfile } from './social-profile';

/** 수동 연결 가능한 소셜 제공자 화이트리스트. */
const LINKABLE_PROVIDERS: readonly SocialProviderName[] = ['kakao', 'google'];

function isLinkableProvider(v: string): v is SocialProviderName {
  return (LINKABLE_PROVIDERS as readonly string[]).includes(v);
}

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

  // GET /auth/kakao/callback - 카카오 콜백. 로그인/연결 공용(link 쿠키로 분기).
  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  @UseFilters(SocialAuthExceptionFilter)
  async kakaoCallback(
    @Req() req: ExpressRequest & SocialRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleSocialCallback(req, res, 'kakao');
  }

  // ─── 소셜 로그인(구글) ─────────────────────────────────────────
  // 카카오와 동일 구조. 콜백은 공통 handleSocialCallback을 재사용한다.

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
    await this.handleSocialCallback(req, res, 'google');
  }

  // ─── 소셜 계정 수동 연결(계정 병합 2단계) ─────────────────────

  // POST /auth/link/start - 로그인 상태에서 연결 시작 코드 발급(1회용·단명).
  // 프론트는 이 코드로 GET /auth/:provider/link?code= 로 top-level 이동한다.
  @Post('link/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  startLink(@Request() req: AuthenticatedRequest): { code: string } {
    return { code: this.authService.issueLinkCode(req.user.id, 'link') };
  }

  // POST /auth/merge/start - 빈 신규 계정을 기존 계정에 흡수(계정 병합 3단계) 시작.
  // 온보딩 화면에서 "기존 계정에 연결"을 누르면 호출한다. 이후 GET
  // /auth/:provider/link?ticket= 로 기존 계정의 provider 로그인을 시작한다.
  @Post('merge/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  startMerge(@Request() req: AuthenticatedRequest): { code: string } {
    return { code: this.authService.issueLinkCode(req.user.id, 'merge') };
  }

  // GET /auth/kakao/link - 연결용 카카오 인가 시작. 가드가 link code를 쿠키로
  // 옮기고 CSRF state를 심는다. 콜백이 link 쿠키를 보고 "연결 모드"로 처리한다.
  @Get('kakao/link')
  @UseGuards(LinkInitiateGuard('kakao'))
  kakaoLink(): void {
    // 가드가 카카오 인가 페이지로 302 리다이렉트.
  }

  @Get('google/link')
  @UseGuards(LinkInitiateGuard('google'))
  googleLink(): void {
    // 가드가 구글 인가 페이지로 302 리다이렉트.
  }

  // DELETE /auth/link/:provider - 연결 해제. 마지막 로그인 수단은 403.
  @Delete('link/:provider')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async unlink(
    @Request() req: AuthenticatedRequest,
    @Param('provider') provider: string,
  ): Promise<{ linkedProviders: SocialProviderName[] }> {
    if (!isLinkableProvider(provider)) {
      throw new BadRequestException('지원하지 않는 제공자입니다.');
    }
    const linkedProviders = await this.authService.unlinkSocialIdentity(
      req.user.id,
      provider,
    );
    return { linkedProviders };
  }

  /**
   * 소셜 콜백 공통 처리. link 쿠키가 있으면 "연결 모드"(현재 유저에 신원 붙임),
   * 없으면 "로그인 모드"(일회용 코드로 프론트 리다이렉트).
   *
   * 연결 모드의 오류는 로그인 화면이 아니라 대시보드로 돌려보낸다(?linkError=).
   * 로그인 모드의 게이트/OAuth 실패는 SocialAuthExceptionFilter가 처리한다.
   */
  private async handleSocialCallback(
    req: ExpressRequest & SocialRequest,
    res: Response,
    provider: SocialProviderName,
  ): Promise<void> {
    const frontend = this.frontendUrl();
    const linkCode = readLinkCode(req, res, provider);

    // state(CSRF) 대조. 연결 모드면 실패를 대시보드로 안내(로그인 화면 아님).
    try {
      verifyOAuthState(req, res, provider);
    } catch (err) {
      if (linkCode) {
        res.redirect(`${frontend}/caregiver?linkError=state`);
        return;
      }
      throw err; // 로그인 모드 → 예외 필터가 /login 으로 처리.
    }

    // ── 연결/병합 모드 ──
    if (linkCode) {
      const redeemed = this.authService.redeemLinkCode(linkCode);
      if (!redeemed) {
        res.redirect(`${frontend}/caregiver?linkError=expired`);
        return;
      }

      // 병합 모드: 현재(빈 신규) 계정을 OAuth로 증명한 기존 계정에 흡수.
      if (redeemed.mode === 'merge') {
        try {
          const code = await this.authService.mergeAndIssueLoginCode(
            redeemed.userId,
            req.user,
          );
          // 병합 성공 → 흡수한 기존 계정 세션으로 로그인(코드 교환).
          res.redirect(
            `${frontend}/auth/callback#code=${encodeURIComponent(code)}`,
          );
        } catch (err) {
          const reason =
            err instanceof NotFoundException
              ? 'notfound'
              : err instanceof HttpException &&
                  err.getStatus() === HttpStatus.CONFLICT
                ? 'conflict'
                : 'unknown';
          res.redirect(`${frontend}/onboarding?mergeError=${reason}`);
        }
        return;
      }

      // 연결 모드: 현재 계정에 새 provider 추가.
      try {
        await this.authService.linkSocialIdentity(redeemed.userId, req.user);
        res.redirect(`${frontend}/caregiver?linked=${provider}`);
      } catch (err) {
        const reason =
          err instanceof HttpException && err.getStatus() === HttpStatus.CONFLICT
            ? 'conflict'
            : 'unknown';
        res.redirect(`${frontend}/caregiver?linkError=${reason}`);
      }
      return;
    }

    // ── 로그인 모드 ──
    const code = await this.authService.socialLoginToCode(req.user);
    // 코드를 쿼리(?)가 아니라 프래그먼트(#)로 전달한다. 프래그먼트는 서버로
    // 전송되지 않아(액세스 로그·Referer에 안 남음) 단명 코드의 유출면을 줄인다.
    res.redirect(`${frontend}/auth/callback#code=${encodeURIComponent(code)}`);
  }

  /** 프론트 오리진(소셜 리다이렉트 대상). 미설정 시 dev 기본값. */
  private frontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    );
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
