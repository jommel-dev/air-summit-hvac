/**
 * =====================================================
 * MATERIALS MODULE
 * =====================================================
 * Purpose: NestJS module that bundles materials functionality
 * 
 * A module in NestJS:
 * - Groups related components (controllers, services, etc.)
 * - Defines dependencies
 * - Can be imported by other modules
 * 
 * This module provides material inventory management features
 * =====================================================
 */

import { Module } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  /**
   * imports: Other modules that this module depends on
   * DatabaseModule provides database connection
   */
  imports: [DatabaseModule, AuditLogModule],
  
  /**
   * controllers: HTTP request handlers
   * MaterialsController handles all /inventory/materials endpoints
   */
  controllers: [MaterialsController],
  
  /**
   * providers: Services that can be injected
   * MaterialsService contains business logic
   */
  providers: [MaterialsService],
  
  /**
   * exports: Services that other modules can use
   * Exporting MaterialsService allows other modules to use material operations
   */
  exports: [MaterialsService],
})
export class MaterialsModule {}
