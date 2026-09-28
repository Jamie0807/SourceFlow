import { Controller, Get, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './database/prisma.module.js';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'api' };
  }
}

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
