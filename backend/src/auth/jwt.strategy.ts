import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from './entities/user.entity';
import { AuthService, JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    super({
      // Authorization 헤더의 Bearer 토큰에서 JWT 추출
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'memorylink-secret-key-change-in-prod',
      ),
    });
  }

  // 검증된 payload로 사용자 조회 - 반환값이 Request.user에 주입됨
  async validate(payload: JwtPayload): Promise<User> {
    return this.authService.validateUser(payload);
  }
}
