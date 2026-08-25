import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { EffectivePatientId } from '../auth/decorators/effective-patient-id.decorator';
import { SpeechDataService } from './speech-data.service';

/**
 * 음성 데이터 보존 동의·삭제 API (보호자가 환자를 대신해 조작).
 *
 * 대상 환자는 @EffectivePatientId로 토큰에서 도출한다(다른 환자 접근 차단).
 */
@Controller('speech-data')
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class SpeechDataController {
  constructor(private readonly speechData: SpeechDataService) {}

  /** GET /speech-data/consent — 현재 동의 상태 + 보존 건수. */
  @Get('consent')
  async getConsent(@EffectivePatientId() patientId: string) {
    const { consent, consentAt } = await this.speechData.getConsent(patientId);
    const count = await this.speechData.count(patientId);
    return { consent, consentAt, count };
  }

  /** PUT /speech-data/consent — 동의 켜기/끄기. */
  @Put('consent')
  async setConsent(
    @EffectivePatientId() patientId: string,
    @Body() body: { consent: boolean },
  ) {
    await this.speechData.setConsent(patientId, body.consent === true);
    return { consent: body.consent === true };
  }

  /** DELETE /speech-data — 보존된 발화를 전부 삭제(파일 + 메타). */
  @Delete()
  async deleteAll(@EffectivePatientId() patientId: string) {
    return this.speechData.deleteAll(patientId);
  }
}
