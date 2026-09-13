import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type LocaleField,
} from '../common/locale';
import type { UpdateLocaleDto } from './dto/update-locale.dto';

export interface SupportedLocalesResponse {
  patient: string[];
  caregiver: string[];
}

export interface LocaleSettingsResponse {
  patientLocale: string;
  /** 보호자 계정이 아니면(환자 직접 로그인) null — 보호자 행이 없다. */
  caregiverLocale: string | null;
}

/**
 * 로케일 쓰기 경로 — 영어판 게이트(계획서 0-5c)가 걸리는 **유일한 자리**.
 *
 * ```
 *   PUT /settings/locale { patientLocale?, caregiverLocale? }
 *        │
 *   둘 다 SUPPORTED_LOCALES와 대조 ── 하나라도 없으면 400, 아무것도 안 쓴다
 *        │
 *   환자 행(유효 환자) · 보호자 행(본인)을 한 트랜잭션으로
 * ```
 *
 * 프론트가 버튼을 숨기는 것만으로는 문을 안 잠근 것이다 — API가 값을 그대로
 * 받으면 버튼이 없어도 들어간다. 그래서 거부는 서버가 한다.
 *
 * **대조를 쓰기 전에 끝낸다.** 둘 중 하나만 미지원이어도 둘 다 안 쓴다 —
 * 반쯤 바뀐 상태(환자는 영어, 보호자는 한국어로 남는 식)를 만들지 않는다.
 */
@Injectable()
export class LocaleSettingsService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  getSupported(): SupportedLocalesResponse {
    return {
      patient: [...SUPPORTED_LOCALES.patient],
      caregiver: [...SUPPORTED_LOCALES.caregiver],
    };
  }

  async read(actor: User): Promise<LocaleSettingsResponse> {
    const patientId = resolveEffectivePatientId(actor);
    const ids =
      actor.role === 'caregiver' ? [patientId, actor.id] : [patientId];
    const rows = await this.users.find({
      where: { id: In(ids) },
      select: { id: true, locale: true },
    });
    const localeOf = (id: string) =>
      rows.find((r) => r.id === id)?.locale ?? DEFAULT_LOCALE;
    return {
      patientLocale: localeOf(patientId),
      caregiverLocale: actor.role === 'caregiver' ? localeOf(actor.id) : null,
    };
  }

  async update(
    actor: User,
    dto: UpdateLocaleDto,
  ): Promise<LocaleSettingsResponse> {
    const { patientLocale, caregiverLocale } = dto;
    if (patientLocale === undefined && caregiverLocale === undefined) {
      throw new BadRequestException('바꿀 로케일이 없습니다.');
    }
    // 역할 판정 먼저 — therapist 등은 여기서 403.
    const patientId = resolveEffectivePatientId(actor);
    if (caregiverLocale !== undefined && actor.role !== 'caregiver') {
      throw new ForbiddenException(
        '보호자 로케일은 보호자 계정에서만 바꿀 수 있습니다.',
      );
    }
    this.assertSupported('patient', patientLocale);
    this.assertSupported('caregiver', caregiverLocale);

    await this.users.manager.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      if (patientLocale !== undefined) {
        await repo.update({ id: patientId }, { locale: patientLocale });
      }
      if (caregiverLocale !== undefined) {
        await repo.update({ id: actor.id }, { locale: caregiverLocale });
      }
    });

    return this.read(actor);
  }

  private assertSupported(
    field: LocaleField,
    locale: string | undefined,
  ): void {
    if (locale === undefined) return;
    if (!isSupportedLocale(field, locale)) {
      throw new BadRequestException(
        `지원하지 않는 ${field === 'patient' ? '환자' : '보호자'} 로케일입니다: ${locale}`,
      );
    }
  }
}
