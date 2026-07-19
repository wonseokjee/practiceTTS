import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Query,
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
import { aiServiceHeaders } from '../common/ai-service-auth';

/** 업로드 오디오 상한 (ai-service와 동일 기준). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** 음성 합성/인식 대기 상한. */
const STT_TIMEOUT_MS = 20_000;
const TTS_TIMEOUT_MS = 15_000;

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
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() body: { lang?: string; candidates?: string | string[] },
    @Res() res: Response,
  ): Promise<void> {
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
      res
        .status(HttpStatus.BAD_GATEWAY)
        .json({ message: '음성 인식 서버에 연결하지 못했습니다.' });
    }
  }

  /**
   * GET /ai/tts — 합성된 오디오를 그대로 흘려보낸다.
   *
   * 프론트는 fetch로 받아 Blob URL로 재생한다(헤더를 붙이기 위해).
   */
  @Get('tts')
  async tts(
    @Query('text') text: string | undefined,
    @Query('voice') voice: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
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
      res
        .status(HttpStatus.BAD_GATEWAY)
        .json({ message: '음성 합성 서버에 연결하지 못했습니다.' });
    }
  }

  private describe(error: unknown): string {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    const message = error instanceof Error ? error.message : String(error);
    return status ? `${status} ${message}` : message;
  }
}
