import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CryptoService } from '../memory/services/crypto.service';
import { FamilyMember } from './entities/family-member.entity';
import { PatientProfile } from './entities/patient-profile.entity';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PersonaContextService } from './services/persona-context.service';

/**
 * 환자 프로필(가족 페르소나) 모듈.
 * - PatientProfile, FamilyMember 엔티티 등록.
 * - CryptoService는 ConfigService만 의존하므로 안전하게 재등록 (training 모듈과 동일 패턴).
 * - PersonaContextService를 export하여 MemoryModule(치환)·TrainingModule(역치환)이 주입.
 * - AuthModule: JwtAuthGuard 재사용.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PatientProfile, FamilyMember]),
    AuthModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService, PersonaContextService, CryptoService],
  exports: [PersonaContextService],
})
export class ProfileModule {}
