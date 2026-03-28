import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** 메시지 전송 요청 DTO (환자 발화 텍스트) */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  transcript: string;
}
