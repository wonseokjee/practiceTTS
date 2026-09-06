import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { SocialIdentity } from './entities/social-identity.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OnboardingGuard } from './onboarding.guard';
import { JwtStrategy } from './jwt.strategy';
import { KakaoStrategy } from './kakao.strategy';
import { GoogleStrategy } from './google.strategy';
import { SocialAuthExceptionFilter } from './social-auth-exception.filter';
import { resolveJwtSecret } from './auth.constants';
import { RateLimitGuard } from '../common/rate-limit.guard';

@Module({
  imports: [
    // User + 소셜 신원(계정 병합) Repository 등록
    TypeOrmModule.forFeature([User, SocialIdentity]),
    PassportModule,
    // JWT 설정: 환경변수에서 시크릿 키 주입
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: resolveJwtSecret(configService),
        signOptions: {
          // StringValue 타입 호환을 위해 '7d' 리터럴 타입으로 단언
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ??
            '7d') as '7d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    KakaoStrategy,
    GoogleStrategy,
    JwtAuthGuard,
    OnboardingGuard,
    SocialAuthExceptionFilter,
    RateLimitGuard,
  ],
  // 다른 모듈에서 가드와 서비스를 사용할 수 있도록 export
  exports: [JwtAuthGuard, OnboardingGuard, AuthService],
})
export class AuthModule {}
