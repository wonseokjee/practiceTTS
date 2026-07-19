import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { User } from '../auth/entities/user.entity';
import { aiServiceHeaders } from '../common/ai-service-auth';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';

/** JwtAuthGuard가 주입한 사용자. 레이트리밋 키로 쓴다. */
interface AuthenticatedRequest {
  user: User;
}

/** 업로드 오디오 상한 (ai-service와 동일 기준). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** 음성 합성/인식 대기 상한. */
const STT_TIMEOUT_MS = 20_000;
const TTS_TIMEOUT_MS = 15_000;

/**
 * 사용자 1명당 분당 한도.
 *
 * ai-service에도 레이트리밋이 있지만, 프록시를 거치면서 그쪽이 보는 IP가
 * 전부 백엔드 하나가 됐다 — 전 사용자 합산 전역 한도가 되어 한 사람이
 * 소진하면 모두가 잠긴다. 여기서 사용자별로 나눠야 격리가 유지된다.
 * ai-service 쪽 한도(tts 120, stt 60)보다 낮게 잡아 이쪽이 먼저 걸리게 한다.
 */
const TTS_PER_USER_PER_MIN = 60;
const STT_PER_USER_PER_MIN = 30;
const RATE_WINDOW_MS = 60_000;

/**
 * ai-service 음성 기능 프록시.
 *
 * 왜 프록시인가
 * -------------
 * `/stt`·`/tts`는 원래 브라우저가 ai-service를 **직접** 호출했다. 그래서 그
 * 두 경로만 인증을 걸 수 없었다 — 브라우저에 심은 토큰은 비밀이 아니기 때문이다.
 * 결과적으로 누구나 Azure 음성 할당량을 태울 수 있었고, 방어선은 IP 레이트리밋뿐이었다.
 *
 * 여기로 옮기면 JWT로 막힌다. 브라우저는 로그인한 사용자만 호출할 수 있고,
 * ai-service는 백엔드에서 오는 요청만 받으면 된다(서비스 토큰).
 *
 * 토큰을 URL에 싣지 않는다
 * ------------------------
 * `<audio src>`는 헤더를 못 붙여서 `?token=`을 쓰고 싶어지지만, URL은 로그·기록에
 * 남는다. 프론트가 fetch로 받아 Blob URL을 만들어 재생하므로 헤더로 충분하다.
 */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiProxyController {
  private readonly logger = new Logger(AiProxyController.name);
  private readonly baseUrl: string;
  private readonly ttsLimiter = new SlidingWindowRateLimiter(
    TTS_PER_USER_PER_MIN,
    RATE_WINDOW_MS,
  );
  private readonly sttLimiter = new SlidingWindowRateLimiter(
    STT_PER_USER_PER_MIN,
    RATE_WINDOW_MS,
  );

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * POST /ai/stt — 녹음 WAV를 ai-service로 넘겨 인식 결과를 돌려준다.
   */
  @Post('stt')
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }),
  )
  async stt(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() body: { lang?: string; candidates?: string | string[] },
    @Res() res: Response,
  ): Promise<void> {
    if (!this.sttLimiter.allow(req.user.id)) {
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .json({ message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
      return;
    }
    if (!audio) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: '오디오 파일이 필요합니다.' });
      return;
    }

    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(audio.buffer)], {
        type: audio.mimetype || 'audio/wav',
      }),
      audio.originalname || 'speech.wav',
    );
    form.append('lang', body.lang ?? 'ko-KR');

    // candidates는 phrase hint다. 빠뜨리면 인식 정확도가 눈에 띄게 떨어지므로
    // 반드시 그대로 넘긴다(폼 필드가 하나면 문자열, 여럿이면 배열로 온다).
    const candidates = body.candidates;
    if (typeof candidates === 'string') {
      form.append('candidates', candidates);
    } else if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        form.append('candidates', candidate);
      }
    }

    try {
      const upstream = await firstValueFrom(
        this.httpService.post<unknown>(`${this.baseUrl}/stt`, form, {
          timeout: STT_TIMEOUT_MS,
          headers: aiServiceHeaders(this.configService),
        }),
      );
      res.status(HttpStatus.OK).json(upstream.data);
    } catch (error) {
      this.logger.warn(`STT 프록시 실패: ${this.describe(error)}`);
      const status = this.upstreamStatus(error);
      res.status(status).json({
        message:
          status === HttpStatus.TOO_MANY_REQUESTS
            ? '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.'
            : '음성 인식 서버에 연결하지 못했습니다.',
      });
    }
  }

  /**
   * GET /ai/tts — 합성된 오디오를 그대로 흘려보낸다.
   *
   * 프론트는 fetch로 받아 Blob URL로 재생한다(헤더를 붙이기 위해).
   */
  @Get('tts')
  async tts(
    @Req() req: AuthenticatedRequest,
    @Query('text') text: string | undefined,
    @Query('voice') voice: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.ttsLimiter.allow(req.user.id)) {
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .json({ message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
      return;
    }
    if (!text || text.trim().length === 0) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: '합성할 문장이 필요합니다.' });
      return;
    }

    try {
      const upstream = await firstValueFrom(
        this.httpService.get<ArrayBuffer>(`${this.baseUrl}/tts`, {
          params: voice ? { text, voice } : { text },
          responseType: 'arraybuffer',
          timeout: TTS_TIMEOUT_MS,
          headers: aiServiceHeaders(this.configService),
        }),
      );

      const contentType =
        (upstream.headers as Record<string, string>)['content-type'] ??
        'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      // 같은 문장은 자주 반복된다(지시문·피드백). 브라우저 캐시를 허용하되
      // 사용자별 토큰으로 받은 응답이라 공유 캐시에는 올리지 않는다.
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(HttpStatus.OK).send(Buffer.from(upstream.data));
    } catch (error) {
      this.logger.warn(`TTS 프록시 실패: ${this.describe(error)}`);
      const status = this.upstreamStatus(error);
      res.status(status).json({
        message:
          status === HttpStatus.TOO_MANY_REQUESTS
            ? '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.'
            : '음성 합성 서버에 연결하지 못했습니다.',
      });
    }
  }

  /**
   * 업스트림 상태코드를 그대로 넘긴다.
   *
   * 전부 502로 뭉개면 클라이언트가 재시도 가능 여부를 판단할 수 없다.
   * 429(레이트리밋)·413(용량 초과)은 원인이 분명해 그대로 전달하는 편이 낫다.
   * 그 외(연결 실패·타임아웃)만 502로 본다.
   */
  private upstreamStatus(error: unknown): number {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    if (status === HttpStatus.TOO_MANY_REQUESTS) return status;
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return status;
    return HttpStatus.BAD_GATEWAY;
  }

  private describe(error: unknown): string {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    const message = error instanceof Error ? error.message : String(error);
    return status ? `${status} ${message}` : message;
  }
}
