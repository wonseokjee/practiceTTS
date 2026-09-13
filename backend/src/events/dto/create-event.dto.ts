import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /events 바디.
 *
 * `eventName`이 레지스트리에 있는지, `payload`의 키가 그 이벤트에 허용되는지는
 * 여기서 검사하지 않는다 — 둘 다 요청마다 달라지는 게 아니라 **정적 목록**이라
 * class-validator 데코레이터보다 `EventsService`에서 레지스트리를 직접 보는 쪽이
 * 간단하다(퀴즈 컨트롤러의 `isQabSubtest`와 같은 자리).
 */
export class CreateEventDto {
  @IsString()
  @MaxLength(64)
  eventName: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
