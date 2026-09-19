import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'api' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

const bootstrap = async () => {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.listen({ port: 3000, host: '0.0.0.0' });
};

void bootstrap();
