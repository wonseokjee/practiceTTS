import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /health — 외부 가동 감시용. 200이면 DB까지 응답한다, 아니면 503.
   * (`GET /`는 프로세스 생존만 본다 — DB가 죽어도 200이라 감시에 부족하다.)
   */
  @Get('health')
  health(): Promise<{ status: 'ok' }> {
    return this.appService.checkHealth();
  }
}
