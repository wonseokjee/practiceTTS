import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

/** 보존된 발화의 과제 종류. */
export type SpeechTask =
  | 'pronunciation'
  | 'stt'
  | 'naming'
  | 'repeat'
  | 'reading';

/** 클라이언트가 실어 보낼 수 있는 과제. 나머지(pronunciation·stt)는 호출 경로 기본값이다. */
const CLIENT_SPEECH_TASKS = ['naming', 'repeat', 'reading'] as const;
export type ClientSpeechTask = (typeof CLIENT_SPEECH_TASKS)[number];

/**
 * 폼 필드 `task`를 읽는다. 없거나 모르는 값이면 null — 호출부가 경로 기본값으로 저장한다.
 * 이름대기와 따라말하기는 같은 발음 채점 경로를 타서, 이 값이 없으면 학습셋에서 가를 수 없다.
 */
export function parseClientSpeechTask(value: unknown): ClientSpeechTask | null {
  return (CLIENT_SPEECH_TASKS as readonly unknown[]).includes(value)
    ? (value as ClientSpeechTask)
    : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 폼 필드 `clip_id`를 읽는다. UUID가 아니면 null — 녹음은 그대로 남기고 연결만 포기한다. */
export function parseClipId(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * 동의 기반으로 보존된 환자 발화 1건.
 *
 * 자체 구음장애 ASR 학습 데이터. target_text가 정답 라벨이므로 지도학습에 바로
 * 쓸 수 있다. audio_path는 파일 스토리지 경로(SPEECH_DATA_DIR 하위). 삭제 요구 시
 * patient_id로 조각만 지우면 되도록 화자별로 분리 저장한다.
 */
@Entity('speech_recordings')
@Index('IDX_speech_recordings_patient', ['patientId'])
@Index('IDX_speech_recordings_clip', ['clipId'])
export class SpeechRecording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_speech_recordings_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'task', type: 'varchar', length: 16 })
  task: SpeechTask;

  // 환자가 말하도록 제시된 목표 텍스트(intended). 정답 라벨 후보이지만, 대상
  // 환자는 목표와 다르게 발화할 수 있어 그 자체로는 신뢰 라벨이 아니다 —
  // recognized_text/score와 함께 판단한다.
  @Column({ name: 'target_text', type: 'text' })
  targetText: string;

  // ASR이 실제로 들은 전사(가설). target_text와 비교해 라벨 신뢰도를 판단하는
  // 오염 필터의 핵심 신호. 인식 결과가 없으면 null.
  @Column({ name: 'recognized_text', type: 'text', nullable: true })
  recognizedText: string | null;

  // 파일 스토리지 상대 경로(예: <patientId>/<uuid>.wav).
  @Column({ name: 'audio_path', type: 'varchar', length: 500 })
  audioPath: string;

  // 앱이 녹음마다 만든 클립 식별자(M35). 같은 값이 qab_results.clip_id에 실려, 학습셋을 만들 때
  // 보호자 정정 같은 문항 판정을 이 녹음에 붙인다. 옛 클라이언트·후보 없는 STT는 NULL.
  @Column({ name: 'clip_id', type: 'uuid', nullable: true })
  clipId: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  // 발음 채점 점수(0~100, pronunciation만). 목표에 얼마나 근접했나의 프록시 —
  // 데이터 품질 필터링에 참고(STT는 null).
  @Column({ name: 'score', type: 'int', nullable: true })
  score: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
