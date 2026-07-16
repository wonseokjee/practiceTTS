import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  VALID_FAMILY_RELATIONS,
  type FamilyRelation,
  MAX_TEXT_FIELD_LENGTH,
  MIN_FAMILY_NAME_LENGTH,
} from '../constants/profile.constants';

/**
 * 가족 구성원 추가/수정 입력 DTO.
 */
export class FamilyMemberInputDto {
  @IsString()
  @IsIn(VALID_FAMILY_RELATIONS, {
    message: `relation은 ${VALID_FAMILY_RELATIONS.join(', ')} 중 하나여야 합니다.`,
  })
  relation: FamilyRelation;

  // 최소 2자인 이유: 이름은 노트 본문에서 통째로 찾아 토큰([아들1])으로 바꾸는
  // 열쇠다. 1자 이름("김")을 허용하면 그 글자가 들어간 무관한 낱말까지 전부
  // 치환되어("김밥" → "[아들1]밥") LLM에 넘길 텍스트가 망가진다.
  // 한국 성씨는 대개 1자이므로, 실수로 성만 넣는 것도 함께 막힌다.
  @IsString()
  @Length(MIN_FAMILY_NAME_LENGTH, MAX_TEXT_FIELD_LENGTH, {
    message: `이름은 ${MIN_FAMILY_NAME_LENGTH}~${MAX_TEXT_FIELD_LENGTH}자여야 합니다.`,
  })
  name: string;

  @IsOptional()
  @IsString()
  @IsIn(['M', 'F', 'U'], { message: 'gender는 M, F, U 중 하나여야 합니다.' })
  gender?: 'M' | 'F' | 'U';

  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT_FIELD_LENGTH)
  note?: string;
}
