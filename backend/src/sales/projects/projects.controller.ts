import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { resolveBranchId } from 'src/common/utils/resolve-branch-id';
import { buildAuditContext } from 'src/common/utils/build-audit-context';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { CreateProjectSoaDto } from './dto/create-project-soa.dto';
import { CreateProjectSettlementDto } from './dto/create-project-settlement.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  private getUserId(request: { user?: Record<string, unknown> }): number | undefined {
    const userId = Number(request.user?.sub);
    return Number.isFinite(userId) && userId > 0 ? userId : undefined;
  }

  private getBranchId(
    request: { user?: Record<string, unknown> },
    queryBranchId?: number,
  ): number | undefined {
    return resolveBranchId(request, queryBranchId);
  }

  @Get()
  search(
    @Query() query: ListProjectsQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.projectsService.search({
      ...query,
      branchId: this.getBranchId(request, query.branchId),
    });
  }

  @Get(':id/billing')
  getBilling(@Param('id') id: string) {
    return this.projectsService.getBilling(+id);
  }

  @Get(':id/statement-of-account')
  listStatements(@Param('id') id: string) {
    return this.projectsService.listStatements(+id);
  }

  @Post(':id/statement-of-account')
  createStatement(
    @Param('id') id: string,
    @Body() body: CreateProjectSoaDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.createStatement(
      +id,
      body,
      this.getUserId(request),
      buildAuditContext(request),
    );
  }

  @Patch(':id/statement-of-account/:soaId/send')
  markStatementSent(
    @Param('id') id: string,
    @Param('soaId') soaId: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.markStatementSent(
      +id,
      +soaId,
      buildAuditContext(request),
    );
  }

  @Post(':id/settlements')
  createSettlement(
    @Param('id') id: string,
    @Body() body: CreateProjectSettlementDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.createSettlement(
      +id,
      body,
      this.getBranchId(request),
      buildAuditContext(request),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(+id);
  }

  @Post()
  create(
    @Body() body: CreateProjectDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.create(
      body,
      this.getUserId(request),
      this.getBranchId(request, body.branchId),
      buildAuditContext(request),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateProjectDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.update(+id, body, buildAuditContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.projectsService.remove(+id, buildAuditContext(request));
  }
}
