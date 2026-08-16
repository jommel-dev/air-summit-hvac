import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, JwtAuthGuard],
  exports: [ProjectsService],
})
export class ProjectsModule {}
