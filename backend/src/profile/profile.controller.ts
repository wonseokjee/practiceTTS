import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { FamilyMemberInputDto } from './dto/family-member-input.dto';
import type { PatientProfileResponseDto } from './dto/patient-profile-response.dto';
import { UpsertPatientProfileDto } from './dto/upsert-patient-profile.dto';
import { ProfileService } from './profile.service';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 환자 프로필 컨트롤러 (보호자 전용).
 * - 단일 환자 모델: 대상 환자는 req.user.patientId로 결정.
 * - 모든 엔드포인트 JwtAuthGuard 적용.
 */
@Controller('patient-profile')
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** GET /patient-profile — 보호자 본인 환자의 프로필 조회 */
  @Get()
  async getProfile(
    @Req() req: AuthenticatedRequest,
  ): Promise<PatientProfileResponseDto> {
    const patientId = this.resolvePatientId(req);
    return this.profileService.getProfile(
      { patientId: req.user.patientId },
      patientId,
    );
  }

  /** PUT /patient-profile — 프로필 upsert (family 동봉 시 전체 교체) */
  @Put()
  async upsert(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpsertPatientProfileDto,
  ): Promise<PatientProfileResponseDto> {
    const patientId = this.resolvePatientId(req);
    return this.profileService.upsert(
      req.user.id,
      { patientId: req.user.patientId },
      patientId,
      dto,
    );
  }

  /** POST /patient-profile/family — 가족 1명 추가 */
  @Post('family')
  async addFamily(
    @Req() req: AuthenticatedRequest,
    @Body() dto: FamilyMemberInputDto,
  ): Promise<PatientProfileResponseDto> {
    const patientId = this.resolvePatientId(req);
    return this.profileService.addFamilyMember(
      { patientId: req.user.patientId },
      patientId,
      dto,
    );
  }

  /** DELETE /patient-profile/family/:id — 가족 1명 삭제 */
  @Delete('family/:id')
  async removeFamily(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PatientProfileResponseDto> {
    const patientId = this.resolvePatientId(req);
    return this.profileService.removeFamilyMember(
      { patientId: req.user.patientId },
      patientId,
      id,
    );
  }

  /** 보호자에 연결된 환자가 있는지 확인하고 patientId 반환 */
  private resolvePatientId(req: AuthenticatedRequest): string {
    const patientId = req.user.patientId;
    if (!patientId) {
      throw new BadRequestException('연결된 환자가 없습니다.');
    }
    return patientId;
  }
}
