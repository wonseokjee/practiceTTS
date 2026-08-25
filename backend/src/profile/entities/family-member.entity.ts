import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { FamilyRelation } from '../constants/profile.constants';
import { PatientProfile } from './patient-profile.entity';

/**
 * 가족 구성원 (환자당 N개)
 * - 보호자가 등록하는 환자의 가족(관계 + 실명).
 * - name/note는 PII이므로 서비스 레이어에서 AES-256 암호화하여 저장한다.
 * - (profileId, relation, relationOrdinal)로 토큰을 결정적으로 생성한다.
 */
@Entity('family_members')
// 서수는 토큰([아들1])을 결정적으로 만드는 키다. 중복되면 두 사람이 같은 토큰을
// 갖게 되어 역치환이 깨지므로 UNIQUE로 강제한다.
// (채번은 ProfileService.nextOrdinal의 MAX+1이 서수 재사용을 막는다.)
@Index(
  'UQ_family_members_profile_relation_ord',
  ['profileId', 'relation', 'relationOrdinal'],
  { unique: true },
)
export class FamilyMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PatientProfile, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'profile_id',
    foreignKeyConstraintName: 'FK_family_members_profile',
  })
  profile: PatientProfile;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId: string;

  // 관계: spouse|son|daughter|grandson|granddaughter|sibling|friend|other
  @Column({ name: 'relation', type: 'varchar', length: 20 })
  relation: FamilyRelation;

  // 실명 (AES-256 암호화 저장)
  @Column({ name: 'name', type: 'text' })
  name: string;

  // 성별 (역치환 및 시나리오 톤 조정에 사용)
  @Column({ name: 'gender', type: 'varchar', length: 1, default: 'U' })
  gender: 'M' | 'F' | 'U';

  // 동일 관계 내 구분 서수 (아들1, 아들2). 토큰 생성의 결정성 보장.
  @Column({ name: 'relation_ordinal', type: 'smallint', default: 1 })
  relationOrdinal: number;

  // 비고 (AES-256 암호화 저장, 선택)
  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
