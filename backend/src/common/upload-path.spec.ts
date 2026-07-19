import { isAbsolute, join, resolve } from 'path';
import { DEFAULT_UPLOAD_DIR, resolveUploadDir } from './upload-path';

/**
 * Regression: ISSUE-001 — 업로드 경로와 정적 서빙 경로가 한 단계 어긋나
 * 업로드된 기억 사진이 전부 404가 되던 문제.
 * Found by /qa on 2026-07-19
 * Report: .gstack/qa-reports/qa-report-localhost-2026-07-19.md
 *
 * 저장(multer destination)·읽기(FileStorageService)·정적 서빙(main.ts)이
 * 반드시 같은 디렉토리를 가리켜야 한다. 셋 다 이 함수를 쓰므로, 이 함수가
 * 같은 입력에 같은 절대 경로를 준다는 것이 곧 세 경로의 일치를 보장한다.
 */
describe('resolveUploadDir', () => {
  const originalEnv = process.env['UPLOAD_DIR'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['UPLOAD_DIR'];
    } else {
      process.env['UPLOAD_DIR'] = originalEnv;
    }
  });

  it('기본값을 cwd 기준 절대 경로로 해석한다 (cwd의 상위가 아니라)', () => {
    delete process.env['UPLOAD_DIR'];

    const dir = resolveUploadDir();

    expect(isAbsolute(dir)).toBe(true);
    expect(dir).toBe(resolve(join(process.cwd(), DEFAULT_UPLOAD_DIR)));
    // 회귀의 핵심: 예전 정적 서빙은 '..'를 붙여 한 단계 위를 봤다.
    expect(dir).not.toBe(
      resolve(join(process.cwd(), '..', 'tts-cache', 'memory-images')),
    );
  });

  it('저장·읽기·서빙이 같은 절대 경로를 얻는다', () => {
    delete process.env['UPLOAD_DIR'];

    const fromMulter = resolveUploadDir();
    const fromStorageService = resolveUploadDir(DEFAULT_UPLOAD_DIR);
    const fromStaticServing = resolveUploadDir();

    expect(fromStorageService).toBe(fromMulter);
    expect(fromStaticServing).toBe(fromMulter);
  });

  it('UPLOAD_DIR이 절대 경로면 그대로 쓴다', () => {
    const absolute = resolve(join('/', 'var', 'memorylink', 'photos'));
    process.env['UPLOAD_DIR'] = absolute;

    expect(resolveUploadDir()).toBe(absolute);
  });

  it('UPLOAD_DIR이 상대 경로면 cwd 기준으로 해석한다', () => {
    process.env['UPLOAD_DIR'] = 'custom/photos';

    expect(resolveUploadDir()).toBe(resolve(join(process.cwd(), 'custom/photos')));
  });

  it('명시 인자가 환경변수보다 우선한다', () => {
    process.env['UPLOAD_DIR'] = 'from-env';

    expect(resolveUploadDir('from-arg')).toBe(
      resolve(join(process.cwd(), 'from-arg')),
    );
  });
});
