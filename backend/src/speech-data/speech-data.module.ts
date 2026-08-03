import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { SpeechRecording } from './entities/speech-recording.entity';
import { SpeechDataController } from './speech-data.controller';
import { SpeechDataService } from './speech-data.service';

/**
 * 음성 데이터 보존(동의 기반) 모듈.
 *
 * SpeechDataService를 export 해 AiProxyModule의 프록시가 채점 시 발화를
 * (동의 시) 보존할 수 있게 한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SpeechRecording, User])],
  controllers: [SpeechDataController],
  providers: [SpeechDataService],
  exports: [SpeechDataService],
})
export class SpeechDataModule {}
