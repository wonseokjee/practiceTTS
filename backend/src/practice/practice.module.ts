import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PracticeResult } from './entities/practice-result.entity';
import { User } from '../auth/entities/user.entity';
import { PracticeController } from './practice.controller';
import { PracticeService } from './practice.service';

@Module({
  // User는 활동 일자 버킷을 자를 환자 타임존을 읽는 용도다(M27, 읽기 전용).
  imports: [TypeOrmModule.forFeature([PracticeResult, User])],
  controllers: [PracticeController],
  providers: [PracticeService],
  exports: [PracticeService],
})
export class PracticeModule {}
