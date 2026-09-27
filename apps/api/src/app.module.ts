import { Controller, Get, Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module.js';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'api' };
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
