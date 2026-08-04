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
export type SpeechTask = 'pronunciation' | 'stt' | 'naming' | 'repeat' | 'reading';

/**
 * 동의 기반으로 보존된 환자 발화 1건.
 *
 * 자체 구음장애 ASR 학습 데이터. target_text가 정답 라벨이므로 지도학습에 바로
 * 쓸 수 있다. audio_path는 파일 스토리지 경로(SPEECH_DATA_DIR 하위). 삭제 요구 시
 * patient_id로 조각만 지우면 되도록 화자별로 분리 저장한다.
 */
@Entity('speech_recordings')
@Index('IDX_speech_recordings_patient', ['patientId'])
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

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  // 발음 채점 점수(0~100, pronunciation만). 목표에 얼마나 근접했나의 프록시 —
  // 데이터 품질 필터링에 참고(STT는 null).
  @Column({ name: 'score', type: 'int', nullable: true })
  score: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
