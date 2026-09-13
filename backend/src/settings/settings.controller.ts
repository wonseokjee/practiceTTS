import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { UpdateLocaleDto } from './dto/update-locale.dto';
import {
  LocaleSettingsService,
  type LocaleSettingsResponse,
  type SupportedLocalesResponse,
} from './locale-settings.service';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 계정 설정 — 지금은 언어. 타임존·주 시작 요일 쓰기 경로(계획서 1-3A)가 같은
 * 자리에 붙는다(§7-0: "설정 → 언어·시간").
 */
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly localeSettings: LocaleSettingsService) {}

  /**
   * GET /settings/locales — 고를 수 있는 로케일(필드별). 프론트는 이 목록으로만
   * 선택지를 그린다. 온보딩 도중(환자 연결 전)에도 부를 수 있어야 해서
   * OnboardingGuard를 걸지 않는다 — 목록은 계정과 무관하다.
   */
  @Get('locales')
  getSupportedLocales(): SupportedLocalesResponse {
    return this.localeSettings.getSupported();
  }

  /** GET /settings/locale — 지금 저장된 값(환자·보호자). */
  @Get('locale')
  @UseGuards(OnboardingGuard)
  getLocale(@Req() req: AuthenticatedRequest): Promise<LocaleSettingsResponse> {
    return this.localeSettings.read(req.user);
  }

  /** PUT /settings/locale — 미지원 로케일은 400(계획서 0-5c). */
  @Put('locale')
  @UseGuards(OnboardingGuard)
  updateLocale(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateLocaleDto,
  ): Promise<LocaleSettingsResponse> {
    return this.localeSettings.update(req.user, dto);
  }
}
