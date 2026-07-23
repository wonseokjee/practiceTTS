import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../common/crypto.module';
import { FamilyMember } from './entities/family-member.entity';
import { PatientProfile } from './entities/patient-profile.entity';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PersonaContextService } from './services/persona-context.service';

/**
 * 환자 프로필(가족 페르소나) 모듈.
 * - PatientProfile, FamilyMember 엔티티 등록.
 * - CryptoService는 CryptoModule에서 공유받는다(인스턴스 1개).
 * - PersonaContextService를 export하여 MemoryModule(치환)·TrainingModule(역치환)이 주입.
 * - AuthModule: JwtAuthGuard 재사용.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PatientProfile, FamilyMember]),
    AuthModule,
    CryptoModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService, PersonaContextService],
  exports: [PersonaContextService],
})
export class ProfileModule {}
