import {
  planSpeechExport,
  pseudonymizeSpeaker,
  RecordingRow,
  toJsonl,
} from './speech-export';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const CLIP = '3f1c2b9a-1d2e-4f50-8a6b-0c1d2e3f4a5b';

function rec(over: Partial<RecordingRow> = {}): RecordingRow {
  return {
    patient_id: P1,
    task: 'naming',
    target_text: '바다',
    recognized_text: null,
    audio_path: `${P1}/a.wav`,
    score: 20,
    duration_ms: 900,
    clip_id: null,
    created_at: new Date('2026-10-24T00:00:00Z'),
    ...over,
  };
}

describe('speech-export', () => {
  it('가명 화자 ID는 같은 salt면 고정, salt가 다르면 바뀐다', () => {
    expect(pseudonymizeSpeaker(P1)).toBe(pseudonymizeSpeaker(P1.toUpperCase()));
    expect(pseudonymizeSpeaker(P1)).toMatch(/^spk_[0-9a-f]{12}$/);
    expect(pseudonymizeSpeaker(P1, 'x')).not.toBe(pseudonymizeSpeaker(P1));
    expect(pseudonymizeSpeaker(P1)).not.toBe(pseudonymizeSpeaker(P2));
  });

  it('환자 UUID는 행에도 오디오 경로에도 남지 않는다', () => {
    const plan = planSpeechExport(
      [rec(), rec({ patient_id: P2, audio_path: `${P2}/b.wav` })],
      [],
    );
    const text =
      toJsonl(plan.recordings) + JSON.stringify(plan.copies.map((c) => c.to));
    expect(text).not.toContain(P1);
    expect(text).not.toContain(P2);
    expect(plan.speakers).toBe(2);
    expect(plan.recordings[0].audio_path).toBe(
      `audio/${pseudonymizeSpeaker(P1)}/a.wav`,
    );
    expect(plan.copies[0]).toEqual({
      from: `${P1}/a.wav`,
      to: plan.recordings[0].audio_path,
    });
  });

  it('오디오 경로에 ..가 있어도 묶음 밖을 가리키지 않는다', () => {
    const plan = planSpeechExport([rec({ audio_path: '../../etc/x.wav' })], []);
    expect(plan.recordings[0].audio_path).toBe(
      `audio/${pseudonymizeSpeaker(P1)}/x.wav`,
    );
  });

  it('파일이 없는 녹음은 빼고 센다', () => {
    const plan = planSpeechExport(
      [rec(), rec({ audio_path: `${P1}/gone.wav` })],
      [],
      {
        audioExists: (p) => !p.endsWith('gone.wav'),
      },
    );
    expect(plan.recordings).toHaveLength(1);
    expect(plan.missingAudio).toBe(1);
  });

  it('보호자 정정은 내보내는 녹음과 이어지는 정정 행만 싣는다', () => {
    const plan = planSpeechExport(
      [rec({ clip_id: CLIP.toUpperCase() })],
      [
        { clip_id: CLIP, is_correct: true, caregiver_corrected: true },
        {
          clip_id: '99999999-9999-4999-8999-999999999999',
          is_correct: true,
          caregiver_corrected: true,
        },
        { clip_id: CLIP, is_correct: false, caregiver_corrected: null },
      ],
    );
    expect(plan.recordings[0].clip_id).toBe(CLIP);
    expect(plan.verdicts).toEqual([
      { clip_id: CLIP, is_correct: true, caregiver_corrected: true },
    ]);
  });

  it('toJsonl은 한 줄에 한 행, 빈 목록은 빈 문자열', () => {
    expect(toJsonl([])).toBe('');
    expect(toJsonl([{ a: 1 }, { a: 2 }])).toBe('{"a":1}\n{"a":2}\n');
  });
});
