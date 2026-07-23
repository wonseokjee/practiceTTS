import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MemoryPhotoService } from './services/memory-photo.service';

/**
 * 업로드 사진 접근 통제 회귀 테스트.
 *
 * 배경: 사진은 `app.useStaticAssets`로 **인증 없이** 서빙됐다. 주석은 "UUID
 * 파일명으로 보안 확보"라고 했지만 UUID는 추측 방어일 뿐 접근 통제가 아니다.
 * URL이 한 번 새면(Referer, 프록시 캐시, 액세스 로그, 공유된 스크린샷)
 * 무효화할 수단이 없다. 치매 환자와 가족의 얼굴 사진이라 영향이 크다.
 *
 * 여기서 고정하는 불변식:
 *  - 로그인만으로는 남의 사진에 닿지 못한다 (소유권까지 확인한다)
 *  - 존재 여부를 알려주지 않는다 (권한 없음도 404)
 *  - 파일명에 경로 구분자가 섞이면 거부한다 (DB가 오염돼도 디렉토리 탈출 불가)
 */
describe('MemoryPhotoService — 사진 접근 통제', () => {
  const OWNER_CAREGIVER = 'caregiver-owner';
  const OTHER_CAREGIVER = 'caregiver-other';
  const PATIENT_ID = 'patient-uuid';
  const FILENAME = 'a1b2c3d4.jpg';

  let service: MemoryPhotoService;

  const repoMock = { findOne: jest.fn() };

  /** 소유 보호자 = OWNER_CAREGIVER, 대상 환자 = PATIENT_ID 인 엔트리 */
  const entry = {
    id: 'entry-uuid',
    caregiverId: OWNER_CAREGIVER,
    patientId: PATIENT_ID,
    photoUrl: `/uploads/memory-images/${FILENAME}`,
  } as MemoryEntry;

  const owningCaregiver = {
    id: OWNER_CAREGIVER,
    role: 'caregiver' as const,
    patientId: PATIENT_ID,
  };
  const strangerCaregiver = {
    id: OTHER_CAREGIVER,
    role: 'caregiver' as const,
    patientId: 'someone-elses-patient',
  };
  const linkedPatient = {
    id: PATIENT_ID,
    role: 'patient' as const,
    patientId: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryPhotoService,
        { provide: getRepositoryToken(MemoryEntry), useValue: repoMock },
      ],
    }).compile();
    service = module.get(MemoryPhotoService);
  });

  it('소유 보호자는 자기 환자의 사진을 볼 수 있다', async () => {
    repoMock.findOne.mockResolvedValue(entry);

    await expect(
      service.resolveAccessibleFilename(FILENAME, owningCaregiver),
    ).resolves.toBe(FILENAME);
  });

  it('환자 본인(환자 모드)도 자기 사진을 볼 수 있다', async () => {
    repoMock.findOne.mockResolvedValue(entry);

    await expect(
      service.resolveAccessibleFilename(FILENAME, linkedPatient),
    ).resolves.toBe(FILENAME);
  });

  it('무관한 보호자는 파일명을 알아도 볼 수 없다', async () => {
    // 이것이 이 변경의 핵심이다. 예전에는 URL만 알면 누구나 200을 받았다.
    repoMock.findOne.mockResolvedValue(entry);

    await expect(
      service.resolveAccessibleFilename(FILENAME, strangerCaregiver),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('권한 없음을 403이 아니라 404로 알린다 (존재 여부 노출 금지)', async () => {
    repoMock.findOne.mockResolvedValue(entry);

    // 403은 "그 파일은 있는데 네 것이 아니다"를 알려준다. 어떤 사진이
    // 존재하는지 자체가 정보이므로 없는 것과 구분되지 않게 한다.
    await expect(
      service.resolveAccessibleFilename(FILENAME, strangerCaregiver),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it('DB에 없는 파일명은 404', async () => {
    repoMock.findOne.mockResolvedValue(null);

    await expect(
      service.resolveAccessibleFilename('unknown.jpg', owningCaregiver),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    '../../../etc/passwd',
    'sub/dir.jpg',
    'back\\slash.jpg',
    '..%2Fescape.jpg',
  ])('경로 구분자가 섞인 파일명 %s 은 조회 전에 거부한다', async (bad) => {
    await expect(
      service.resolveAccessibleFilename(bad, owningCaregiver),
    ).rejects.toBeInstanceOf(NotFoundException);

    // 디렉토리 탈출 시도는 DB까지 가지 않고 차단되어야 한다.
    expect(repoMock.findOne).not.toHaveBeenCalled();
  });

  it('연결된 환자가 없는 보호자는 환자 경로로 통과하지 못한다', async () => {
    // resolveEffectivePatientId가 던지는 경우에도 조용히 접근이 열리면 안 된다.
    repoMock.findOne.mockResolvedValue(entry);

    await expect(
      service.resolveAccessibleFilename(FILENAME, {
        id: 'unlinked',
        role: 'caregiver' as const,
        patientId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('therapist 역할도 소유 관계가 없으면 거부된다', async () => {
    repoMock.findOne.mockResolvedValue(entry);

    await expect(
      service.resolveAccessibleFilename(FILENAME, {
        id: 'therapist-uuid',
        role: 'therapist' as const,
        patientId: PATIENT_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
