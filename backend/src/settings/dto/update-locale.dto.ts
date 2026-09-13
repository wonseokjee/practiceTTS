import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * BCP 47 언어-지역 모양(`ko-KR`·`en-US`). `users.locale`이 `varchar(8)`이라
 * 이 모양이면 길이도 맞는다. **지원 여부는 여기서 보지 않는다** — 목록은
 * `SUPPORTED_LOCALES` 한 곳에만 두고 서비스가 대조한다(DTO에 목록을 박으면
 * 문을 열 때 두 곳을 고쳐야 한다).
 */
const LOCALE_SHAPE = /^[a-z]{2}-[A-Z]{2}$/;

/**
 * PUT /settings/locale — 둘 중 하나 이상. 같게 쓰는 게 기본이다(계획서 §7-0:
 * "환자분이 쓸 언어"를 먼저 묻고, 보호자 언어는 다를 때만 따로 묻는다).
 */
export class UpdateLocaleDto {
  @IsOptional()
  @IsString()
  @Matches(LOCALE_SHAPE, {
    message: 'patientLocale은 ko-KR 모양이어야 합니다.',
  })
  patientLocale?: string;

  @IsOptional()
  @IsString()
  @Matches(LOCALE_SHAPE, {
    message: 'caregiverLocale은 ko-KR 모양이어야 합니다.',
  })
  caregiverLocale?: string;
}
