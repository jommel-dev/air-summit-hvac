import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

class SubmitFeedbackDto {
  rating!: number;
  wouldRecommend!: boolean;
  insights?: string;
  name?: string;
}

@Controller('public/feedback')
export class PublicFeedbackController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async submitFeedback(
    @Body() dto: SubmitFeedbackDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const rating = Math.floor(Number(dto.rating ?? 0));
    if (rating < 1 || rating > 5) {
      return { success: false, message: 'Rating must be between 1 and 5.' };
    }

    const wouldRecommend = Boolean(dto.wouldRecommend);
    const insights = String(dto.insights ?? '').trim() || null;
    const name = String(dto.name ?? '').trim() || null;

    try {
      const insertResult = await this.databaseService.query<{ id: number }>(
        `INSERT INTO tblfeedback (rating, would_recommend, insights, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [rating, wouldRecommend, insights, name],
      );

      const feedbackId = insertResult.rows[0]?.id ?? null;

      await this.auditLogService.logMutation({
        action: 'PUBLIC_FEEDBACK_CREATE',
        entityType: 'public-feedback',
        entityId: feedbackId,
        actor: buildAuditContext(request),
        description: 'Submitted public feedback',
        requestBody: {
          rating,
          wouldRecommend,
          insights,
          name,
        },
        after: {
          id: feedbackId,
          rating,
          wouldRecommend,
          insights,
          name,
        },
      });

      return { success: true, message: 'Thank you for your feedback!' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to submit feedback.' };
    }
  }

  @Get('list')
  async listFeedback() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        rating: number;
        would_recommend: boolean;
        insights: string | null;
        name: string | null;
        created_at: string;
      }>(
        `SELECT id, rating, would_recommend, insights, name, created_at
         FROM tblfeedback
         ORDER BY created_at DESC
         LIMIT 50`,
      );
      return {
        success: true,
        items: result.rows.map(r => ({
          id: r.id,
          rating: r.rating,
          wouldRecommend: r.would_recommend,
          insights: r.insights,
          name: r.name,
          createdAt: r.created_at,
        })),
      };
    } catch {
      return { success: false, items: [] };
    }
  }

  @Get('summary')
  async getSummary() {
    try {
      const result = await this.databaseService.query<{
        total: string;
        avg_rating: string;
        recommend_count: string;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           ROUND(AVG(rating)::numeric, 1)::text AS avg_rating,
           SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END)::text AS recommend_count
         FROM tblfeedback`,
      );

      const row = result.rows[0];
      const total = Number(row?.total ?? 0);
      const recommendCount = Number(row?.recommend_count ?? 0);

      return {
        success: true,
        data: {
          total,
          avgRating: Number(row?.avg_rating ?? 0),
          recommendPercent: total > 0 ? Math.round((recommendCount / total) * 100) : 0,
        },
      };
    } catch {
      return { success: false, data: { total: 0, avgRating: 0, recommendPercent: 0 } };
    }
  }
}
