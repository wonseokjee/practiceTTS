import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController', () => {
  it('로그인 사용자 id와 함께 서비스에 위임한다', async () => {
    const recordRequested = jest.fn().mockResolvedValue(undefined);
    const controller = new EventsController({
      recordRequested,
    } as unknown as EventsService);

    await controller.create({ user: { id: 'user-1' } } as never, {
      eventName: 'qab_trend_viewed',
      payload: { screen: 'dashboard' },
    });

    expect(recordRequested).toHaveBeenCalledWith('user-1', 'qab_trend_viewed', {
      screen: 'dashboard',
    });
  });
});
