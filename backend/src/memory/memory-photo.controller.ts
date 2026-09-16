import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { extname } from 'path';
import type { Readable } from 'stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import type { User } from '../auth/entities/user.entity';
import { FileStorageService } from './services/file-storage.service';
import { MemoryPhotoService } from './services/memory-photo.service';

interface AuthenticatedRequest extends Request {
  user: User;
}

/** 업로드 시 허용한 형식과 1:1 대응 (jpeg/png/webp). */
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * 업로드 사진 서빙 — 인증 + 소유권 확인 후에만 내보낸다.
 *
 * 이전에는 `main.ts`의 `app.useStaticAssets`가 같은 경로를 인증 없이 열어
 * 두고 있었다. 경로(`/uploads/memory-images/:filename`)를 그대로 물려받았기
 * 때문에 DB의 photoUrl 값도, 프론트가 만드는 URL도 바꿀 필요가 없다.
 * 바뀐 것은 **응답 전에 소유권을 확인한다**는 점뿐이다.
 *
 * 주의: 이 컨트롤러를 지우거나 경로를 바꾸면 정적 서빙으로 되돌아가는 게
 * 아니라 사진이 404가 된다. 되돌리려면 접근 통제 설계를 먼저 정해야 한다.
 */
@Controller('uploads/memory-images')
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class MemoryPhotoController {
  constructor(
    private readonly memoryPhotoService: MemoryPhotoService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  @Get(':filename')
  // 사용자별 인증 응답이다. 공유 캐시(프록시·CDN)에 올라가면 접근 통제가
  // 무의미해지므로 private으로 못박는다.
  @Header('Cache-Control', 'private, max-age=3600')
  // 사진 URL이 외부 사이트로 새어나가지 않게 한다.
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  async serve(
    @Param('filename') filename: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const safeName = await this.memoryPhotoService.resolveAccessibleFilename(
      filename,
      req.user,
    );

    const contentType = CONTENT_TYPES[extname(safeName).toLowerCase()];
    if (!contentType) {
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    }

    // DB에는 있는데 저장소(로컬 디스크 또는 R2)에 없는 경우(수동 삭제·볼륨
    // 미마운트)를 500이 아닌 404로 돌려준다. 드라이버마다 "없음"의 에러
    // 모양이 다르므로(ENOENT vs NoSuchKey) 종류를 가리지 않고 404로 묶는다.
    let stream: Readable;
    try {
      stream = await this.fileStorageService.readStream(safeName);
    } catch {
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    }

    return new StreamableFile(stream, { type: contentType });
  }
}
