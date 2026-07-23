import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserRole } from '../../auth/entities/user.entity';
import { resolveEffectivePatientId } from '../../auth/effective-patient-id.util';
import { MemoryEntry } from '../entities/memory-entry.entity';

/** 사진 접근 판정에 필요한 최소 사용자 정보 */
export interface PhotoViewer {
  id: string;
  role: UserRole;
  patientId: string | null;
}

/** photoUrl 컬럼에 저장되는 접두사 — 저장 형식을 바꾸지 않고 그대로 조회한다. */
const PHOTO_URL_PREFIX = '/uploads/memory-images/';

/**
 * 업로드 사진의 접근 통제.
 *
 * 예전에는 `app.useStaticAssets`로 인증 없이 서빙했고, 근거는 "UUID 파일명"
 * 이었다. UUID는 **추측 방어**일 뿐 접근 통제가 아니다 — URL이 Referer 헤더,
 * 프록시 캐시, 액세스 로그, 공유된 스크린샷 중 어디로든 한 번 새면 무효화할
 * 방법이 없다. 파일을 지우는 것 말고는.
 *
 * 이 서비스는 파일명을 소유 관계로 되짚어 판정한다. 저장 형식(photoUrl)과
 * URL 경로를 그대로 두었기 때문에 DB 마이그레이션도 프론트 URL 변경도 없다.
 */
@Injectable()
export class MemoryPhotoService {
  constructor(
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
  ) {}

  /**
   * 이 사용자가 볼 수 있는 사진이면 파일명을 돌려준다.
   *
   * 볼 수 있는 경우는 둘뿐이다:
   *   - 엔트리를 만든 보호자 본인
   *   - 그 엔트리의 대상 환자(환자 모드 포함)
   *
   * 권한이 없거나 없는 파일이면 **둘 다 404**를 던진다. 403으로 구분하면
   * "그 사진은 존재한다"는 사실 자체가 새어나가기 때문이다.
   */
  async resolveAccessibleFilename(
    filename: string,
    viewer: PhotoViewer,
  ): Promise<string> {
    // DB가 오염되거나 라우팅이 바뀌어도 디렉토리를 벗어나지 못하게, 조회 전에
    // 경로 구분자를 막는다. 정상 파일명은 UUID + 확장자라 이 문자가 없다.
    if (!filename || /[\\/]|\.\./.test(decodeURIComponent(filename))) {
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    }

    const entry = await this.memoryEntryRepository.findOne({
      where: { photoUrl: `${PHOTO_URL_PREFIX}${filename}`, isActive: true },
    });
    if (!entry) {
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    }

    if (!this.canView(entry, viewer)) {
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    }

    return filename;
  }

  private canView(entry: MemoryEntry, viewer: PhotoViewer): boolean {
    if (entry.caregiverId === viewer.id) {
      return true;
    }
    // 환자 모드 접근. resolveEffectivePatientId는 연결된 환자가 없거나
    // 허용되지 않는 역할이면 throw하는데, 그건 "권한 없음"이지 서버 오류가
    // 아니므로 흡수해서 거부로 처리한다.
    try {
      return entry.patientId === resolveEffectivePatientId(viewer);
    } catch {
      return false;
    }
  }
}
