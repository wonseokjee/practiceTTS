import { SetMetadata } from '@nestjs/common';
import type { EventName } from './event-registry';

export const TRACK_VIEW_KEY = 'track-view-event-name';

/**
 * GET 라우트에 붙여 성공적으로 응답한 뒤 열람 이벤트를 기록한다.
 *
 *   @Get('quiz/qab-trend')
 *   @TrackView('qab_trend_viewed')
 *   getQabTrend(...) { ... }
 *
 * `RateLimitGuard`·`DailyCapGuard`와 같은 `SetMetadata`/`Reflector` 자리다.
 * 다만 이건 **가드가 아니라 인터셉터**다 — 가드는 핸들러 실행 *전*에 돌아
 * 막을지만 결정하고, 열람 기록은 핸들러가 실제로 성공한 *뒤*에 일어나야 한다
 * (실패한 요청을 "봤다"고 셀 이유가 없다).
 */
export const TrackView = (eventName: EventName) =>
  SetMetadata(TRACK_VIEW_KEY, eventName);
