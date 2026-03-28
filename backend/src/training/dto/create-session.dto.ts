import { IsString, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';

/** 훈련 세션 생성 요청 DTO */
export class CreateSessionDto {
  @IsUUID()
  @IsNotEmpty()
  memoryEntryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  targetWord: string;
}
