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

  // 환자가 말하도록 제시된 목표 텍스트 = 정답 라벨(지도학습용).
  @Column({ name: 'target_text', type: 'text' })
  targetText: string;

  // 파일 스토리지 상대 경로(예: <patientId>/<uuid>.wav).
  @Column({ name: 'audio_path', type: 'varchar', length: 500 })
  audioPath: string;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  // 발음 채점 점수(있으면). 데이터 품질 필터링에 참고.
  @Column({ name: 'score', type: 'int', nullable: true })
  score: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
