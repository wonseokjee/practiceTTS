import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService, UserResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from './entities/user.entity';

// JWT 인증 후 Request에 주입되는 사용자 타입
interface AuthenticatedRequest {
  user: User;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register - 회원가입
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    return this.authService.register(dto);
  }

  // POST /auth/login - 로그인
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ accessToken: string; user: UserResponse }> {
    return this.authService.login(dto);
  }

  // GET /auth/me - 현재 로그인한 사용자 정보 조회
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: AuthenticatedRequest): Promise<UserResponse> {
    return this.authService.getMe(req.user.id);
  }
}
