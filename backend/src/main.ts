import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log('🚀 Starting HVAC Backend...');
  console.log('PORT:', process.env.PORT || '3000');
  console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
  console.log('JWT_SECRET present:', !!process.env.JWT_SECRET);
  console.log('CORS_ORIGINS:', process.env.CORS_ORIGINS || 'http://localhost:4200');

  const app = await NestFactory.create(AppModule);

  const corsOrigins = String(process.env.CORS_ORIGINS || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  console.log(`📡 Listening on port ${port}...`);

  await app.listen(port, '0.0.0.0');
  console.log('✅ App started successfully!');
}
bootstrap().catch((error) => {
  console.error('❌ Bootstrap failed:', error);
  process.exit(1);
});

