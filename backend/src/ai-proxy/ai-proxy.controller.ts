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
import { OnboardingGuard } from '../auth/onboarding.guard';
import type { User } from '../auth/entities/user.entity';
import { aiServiceHeaders } from '../common/ai-service-auth';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { EffectivePatientId } from '../auth/decorators/effective-patient-id.decorator';
import { SpeechDataService } from '../speech-data/speech-data.service';
import { isSupportedLocale } from '../common/locale';
import { parseCompetitors, parseSttCompetitor } from './competitors';

/** JwtAuthGuard가 주입한 사용자. 레이트리밋 키로 쓴다. */
interface AuthenticatedRequest {
  user: User;
}

/**
 * 업로드 오디오 상한 — ai-service와 **같은 값**이어야 한다.
 *
 * 예전에는 백엔드 10MB / ai-service 5MB로 어긋나 있으면서 주석은 "동일
 * 기준"이라고 적혀 있었다. 그 사이 구간(5~10MB)은 백엔드가 받아 메모리에
 * 올린 뒤 반드시 413으로 실패하는 죽은 구간이었다.
 *
 * 4MB는 16kHz mono 16bit PCM 기준 약 128초다. 클라이언트가 퀴즈 30초에서
 * 스스로 끊으므로 정상 요청은 1MB를 넘지 않는다. 이 값은 안전망이고,
 * 대화 모드를 서버 STT(120초)로 옮길 때까지의 여유를 함께 잡은 것이다.
 */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** 음성 합성/인식 대기 상한. */
const STT_TIMEOUT_MS = 20_000;
const TTS_TIMEOUT_MS = 15_000;

/**
 * 사용자 1명당 분당 한도.
 *
 * ai-service에도 레이트리밋이 있지만, 프록시를 거치면서 그쪽이 보는 IP가
 * 전부 백엔드 하나가 됐다 — 전 사용자 합산 전역 한도가 되어 한 사람이
 * 소진하면 모두가 잠긴다. 여기서 사용자별로 나눠야 격리가 유지된다.
 * ai-service 쪽 한도보다 낮게 잡아 이쪽이 먼저 걸리게 한다.
 *
 * 숫자 근거(실사용 대비 여유):
 *  - STT: 환자는 듣고 생각하고 답해야 하므로 물리적으로 분당 3~6회가 한계다.
 *    12회면 2~4배 여유. 예전 30회는 최대 크기와 곱하면 분당 82분 분량의
 *    오디오(실시간의 82배)를 한 계정이 밀어넣을 수 있었다.
 *  - TTS: 화면당 안내 몇 개 수준이라 분당 3~6회다. 30회면 5배 여유.
 *    예전 60회는 최대 500자와 곱해 분당 3만 자 — 캐시를 피해 매번 다른
 *    텍스트를 보내면 계정 하나로 시간당 수십 달러를 태울 수 있었다.
 */
const TTS_PER_USER_PER_MIN = 30;
const STT_PER_USER_PER_MIN = 12;
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
/**
 * 숫자 상태코드와 비교하기 위해 한 번 넓혀 둔 값.
 *
 * `upstreamStatus()`가 주는 것은 upstream이 준 **임의의 HTTP 숫자**라
 * `HttpStatus` enum 멤버라는 보장이 없다. enum과 직접 비교하면
 * no-unsafe-enum-comparison에 걸리고, 그 경고가 맞다 — 타입이 실제로
 * 다르다. 이름은 지키고 비교만 숫자로 한다.
 */
const TOO_MANY_REQUESTS: number = HttpStatus.TOO_MANY_REQUESTS;

@Controller('ai')
// 순서가 중요하다. JwtAuthGuard가 먼저 돌아야 RateLimitGuard가 req.user.id로
// 버킷을 나눌 수 있다.
@UseGuards(JwtAuthGuard, OnboardingGuard, RateLimitGuard)
export class AiProxyController {
  private readonly logger = new Logger(AiProxyController.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly speechData: SpeechDataService,
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
  // 반드시 인터셉터보다 먼저 잘라야 한다. 실행 순서가
  // 가드 -> 인터셉터라, 여기서 막지 않으면 한도를 넘긴 요청도 multer가
  // 본문을 메모리에 다 올린 뒤에야 429를 받는다.
  @RateLimit({
    name: 'stt',
    limit: STT_PER_USER_PER_MIN,
    windowMs: RATE_WINDOW_MS,
  })
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }),
  )
  async stt(
    @Req() req: AuthenticatedRequest,
    @EffectivePatientId() patientId: string,
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
    if (!body.lang || !isSupportedLocale('patient', body.lang)) {
      res.status(HttpStatus.BAD_REQUEST).json({
        message: '지원하지 않는 언어입니다.',
        code: 'LANG_UNSUPPORTED',
      });
      return;
    }

    // 라벨 = 정답 후보 첫 항목(과제 목표 단어). 후보가 없으면(자유 인식) 라벨이
    // 없어 보존 대상이 아니다. 실제 보존은 인식 결과(가설)를 함께 남기려고
    // 상류 응답 이후에 한다(아래).
    const firstCandidate = Array.isArray(body.candidates)
      ? body.candidates[0]
      : body.candidates;

    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(audio.buffer)], {
        type: audio.mimetype || 'audio/wav',
      }),
      audio.originalname || 'speech.wav',
    );
    form.append('lang', body.lang);

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

      // 응답 후 보존(fire-and-forget). 목표(candidates[0])와 함께 ASR이 실제로
      // 들은 전사(recognized)를 남겨, 학습셋 빌드 시 오염 라벨을 걸러낼 수 있게 한다.
      if (firstCandidate) {
        const recognized = this.readString(upstream.data, 'transcript');
        void this.speechData.saveRecording({
          patientId,
          task: 'stt',
          targetText: firstCandidate,
          audio: audio.buffer,
          recognizedText: recognized,
        });
      }
    } catch (error) {
      this.logger.warn(`STT 프록시 실패: ${this.describe(error)}`);
      const status = this.upstreamStatus(error);
      res.status(status).json({
        message:
          status === TOO_MANY_REQUESTS
            ? '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.'
            : '음성 인식 서버에 연결하지 못했습니다.',
      });
    }
  }

  /**
   * POST /ai/pronunciation — 녹음 WAV + 정답 텍스트를 ai-service로 넘겨
   * 음소 단위 발음 점수를 돌려준다.
   *
   * STT와 같은 비용(Azure 음성)이라 같은 사용자별 한도를 쓴다. 정답을 아는
   * 재활 과제(따라말하기·읽기)에서 reference_text로 목표 문장을 넘긴다.
   *
   * 경쟁자 모드(선택, 이웃 비교 채점): `competitors`(JSON 배열 문자열)와 `stt_competitor`를
   * 검증해 ai-service에 그대로 넘긴다. 사용자별 한도는 **요청 단위 그대로**다 — 경쟁자 요청도
   * 1건이고, 호출 수 가중은 ai-service의 전역 회로차단기가 한다.
   */
  @Post('pronunciation')
  @RateLimit({
    name: 'pronunciation',
    limit: STT_PER_USER_PER_MIN,
    windowMs: RATE_WINDOW_MS,
  })
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }),
  )
  async pronunciation(
    @Req() _req: AuthenticatedRequest,
    @EffectivePatientId() patientId: string,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body()
    body: {
      lang?: string;
      reference_text?: string;
      competitors?: unknown;
      stt_competitor?: unknown;
    },
    @Res() res: Response,
  ): Promise<void> {
    if (!audio) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: '오디오 파일이 필요합니다.' });
      return;
    }
    if (!body.lang || !isSupportedLocale('patient', body.lang)) {
      res.status(HttpStatus.BAD_REQUEST).json({
        message: '지원하지 않는 언어입니다.',
        code: 'LANG_UNSUPPORTED',
      });
      return;
    }
    const competitors = parseCompetitors(body.competitors);
    const sttCompetitor = parseSttCompetitor(body.stt_competitor);
    if (competitors === null || sttCompetitor === null) {
      res.status(HttpStatus.BAD_REQUEST).json({
        message: '경쟁 단어 형식이 올바르지 않습니다.',
        code: 'COMPETITORS_INVALID',
      });
      return;
    }
    const reference = (body.reference_text ?? '').trim();
    if (reference.length === 0) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: '정답 텍스트가 필요합니다.' });
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
    form.append('lang', body.lang);
    form.append('reference_text', reference);
    // 경쟁자 모드는 있을 때만 붙인다 — 없으면 ai-service가 받는 폼이 예전과 같다.
    if (competitors.length > 0) {
      form.append('competitors', JSON.stringify(competitors));
    }
    if (sttCompetitor) {
      form.append('stt_competitor', 'true');
    }

    try {
      const upstream = await firstValueFrom(
        this.httpService.post<unknown>(`${this.baseUrl}/pronunciation`, form, {
          timeout: STT_TIMEOUT_MS,
          headers: aiServiceHeaders(this.configService),
        }),
      );
      res.status(HttpStatus.OK).json(upstream.data);

      // 응답 후 보존(fire-and-forget). 목표 문장 + Azure가 실제로 들은 전사 +
      // 발음 점수(0~100)를 함께 남긴다. 점수/가설로 라벨 신뢰도를 판단해 오염 쌍을
      // 학습에서 배제할 수 있다. 동의 여부는 서비스 내부에서 확인한다.
      void this.speechData.saveRecording({
        patientId,
        task: 'pronunciation',
        targetText: reference,
        audio: audio.buffer,
        recognizedText: this.readString(upstream.data, 'recognized_text'),
        score: this.readScore(upstream.data, 'pronunciation_score'),
      });
    } catch (error) {
      this.logger.warn(`발음 평가 프록시 실패: ${this.describe(error)}`);
      const status = this.upstreamStatus(error);
      res.status(status).json({
        message:
          status === TOO_MANY_REQUESTS
            ? '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.'
            : '발음 평가 서버에 연결하지 못했습니다.',
      });
    }
  }

  /**
   * GET /ai/tts — 합성된 오디오를 그대로 흘려보낸다.
   *
   * 프론트는 fetch로 받아 Blob URL로 재생한다(헤더를 붙이기 위해).
   */
  @Get('tts')
  @RateLimit({
    name: 'tts',
    limit: TTS_PER_USER_PER_MIN,
    windowMs: RATE_WINDOW_MS,
  })
  async tts(
    @Req() req: AuthenticatedRequest,
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
      const status = this.upstreamStatus(error);
      res.status(status).json({
        message:
          status === TOO_MANY_REQUESTS
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
    if (status === TOO_MANY_REQUESTS) return status;
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return status;
    return HttpStatus.BAD_GATEWAY;
  }

  /** 상류 JSON에서 문자열 필드를 안전하게 뽑는다(없으면 null). */
  private readString(data: unknown, key: string): string | null {
    const v = (data as Record<string, unknown> | null)?.[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /** 상류 JSON에서 0~100 점수를 정수로 뽑는다(범위 밖/비수치면 null). */
  private readScore(data: unknown, key: string): number | null {
    const v = (data as Record<string, unknown> | null)?.[key];
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  private describe(error: unknown): string {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    const message = error instanceof Error ? error.message : String(error);
    return status ? `${status} ${message}` : message;
  }
}
