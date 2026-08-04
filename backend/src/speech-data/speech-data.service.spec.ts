import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpeechDataService } from './speech-data.service';

/**
 * 핵심 불변식: **동의 없이는 어떤 오디오도 저장되지 않는다.** (프라이버시 게이트)
 * repo는 목으로, 파일은 임시 디렉토리로 검증한다.
 */
describe('SpeechDataService', () => {
  let tmp: string;
  let recordings: { insert: jest.Mock; find: jest.Mock; delete: jest.Mock; count: jest.Mock };
  let users: { findOne: jest.Mock; update: jest.Mock };
  let svc: SpeechDataService;

  const PID = 'patient-1';

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-test-'));
    recordings = {
      insert: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    };
    users = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    const config = { get: (_k: string, d: string) => (_k === 'SPEECH_DATA_DIR' ? tmp : d) };
    svc = new SpeechDataService(
      recordings as never,
      users as never,
      config as never,
    );
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('미동의면 오디오를 저장하지 않는다 (파일·행 모두 없음)', async () => {
    users.findOne.mockResolvedValue({ speechDataConsent: false });
    await svc.saveRecording({
      patientId: PID,
      task: 'pronunciation',
      targetText: '바다',
      audio: Buffer.from('RIFFwav'),
    });
    expect(recordings.insert).not.toHaveBeenCalled();
    const files = await fs.readdir(tmp).catch(() => []);
    expect(files).toHaveLength(0);
  });

  it('동의하면 파일을 쓰고 메타 행을 넣는다', async () => {
    users.findOne.mockResolvedValue({ speechDataConsent: true });
    await svc.saveRecording({
      patientId: PID,
      task: 'pronunciation',
      targetText: '바다',
      audio: Buffer.from('RIFFwav'),
      score: 91,
    });
    expect(recordings.insert).toHaveBeenCalledTimes(1);
    const row = recordings.insert.mock.calls[0][0];
    expect(row.patientId).toBe(PID);
    expect(row.targetText).toBe('바다');
    expect(row.score).toBe(91);
    expect(row.recognizedText).toBeNull();
    // 파일이 화자 폴더 아래 실제로 생성됨
    const wav = await fs.readFile(path.join(tmp, row.audioPath));
    expect(wav.length).toBeGreaterThan(0);
  });

  it('인식 가설(recognizedText)을 함께 저장한다(오염 필터용)', async () => {
    users.findOne.mockResolvedValue({ speechDataConsent: true });
    await svc.saveRecording({
      patientId: PID,
      task: 'stt',
      targetText: '사과', // 목표
      recognizedText: '아과', // 환자가 실제로 낸 소리(오염 신호)
      audio: Buffer.from('RIFFwav'),
    });
    const row = recordings.insert.mock.calls[0][0];
    expect(row.targetText).toBe('사과');
    expect(row.recognizedText).toBe('아과');
  });

  it('insert 실패 시 방금 쓴 오디오 파일을 되돌린다(고아 파일 방지)', async () => {
    users.findOne.mockResolvedValue({ speechDataConsent: true });
    recordings.insert.mockRejectedValue(new Error('db down'));
    await svc.saveRecording({
      patientId: PID,
      task: 'pronunciation',
      targetText: '바다',
      audio: Buffer.from('RIFFwav'),
    });
    // 파일 쓰기는 됐지만 insert가 깨졌으니, 화자 폴더에 남은 파일이 없어야 한다
    const files = await fs.readdir(path.join(tmp, PID)).catch(() => []);
    expect(files).toHaveLength(0);
  });

  it('동의해도 라벨이 비면 저장하지 않는다', async () => {
    users.findOne.mockResolvedValue({ speechDataConsent: true });
    await svc.saveRecording({
      patientId: PID,
      task: 'stt',
      targetText: '   ',
      audio: Buffer.from('x'),
    });
    expect(recordings.insert).not.toHaveBeenCalled();
  });

  it('setConsent(true)는 동의 시각을 기록한다', async () => {
    await svc.setConsent(PID, true);
    const arg = users.update.mock.calls[0][1];
    expect(arg.speechDataConsent).toBe(true);
    expect(arg.speechDataConsentAt).toBeInstanceOf(Date);
  });

  it('deleteAll은 파일과 행을 지운다', async () => {
    // 실제 파일 하나 생성해두고 삭제되는지 확인
    const rel = path.join(PID, 'x.wav');
    await fs.mkdir(path.join(tmp, PID), { recursive: true });
    await fs.writeFile(path.join(tmp, rel), Buffer.from('data'));
    recordings.find.mockResolvedValue([{ id: 'r1', audioPath: rel }]);

    const res = await svc.deleteAll(PID);

    expect(res.deleted).toBe(1);
    expect(recordings.delete).toHaveBeenCalledWith({ patientId: PID });
    await expect(fs.readFile(path.join(tmp, rel))).rejects.toBeDefined();
  });

  it('파일 삭제가 실패하면 던지고 DB 행을 지우지 않는다(거짓 성공 방지)', async () => {
    recordings.find.mockResolvedValue([{ id: 'r1' }]);
    const rmSpy = jest
      .spyOn(fs, 'rm')
      .mockRejectedValueOnce(new Error('EPERM: 파일 잠김'));

    // 파일 제거 실패는 삼켜지지 않고 호출자에게 전파돼야 한다(API가 실패를 알린다)
    await expect(svc.deleteAll(PID)).rejects.toThrow();
    // 행을 지우지 않아 재시도 가능한 일관 상태로 남는다(오디오·행이 함께 존재)
    expect(recordings.delete).not.toHaveBeenCalled();

    rmSpy.mockRestore();
  });
});
