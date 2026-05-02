import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

class SubmitFeedbackDto {
  rating!: number;
  wouldRecommend!: boolean;
  insights?: string;
  name?: string;
}

@Controller('public/feedback')
export class PublicFeedbackController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Post()
  async submitFeedback(@Body() dto: SubmitFeedbackDto) {
    const rating = Math.floor(Number(dto.rating ?? 0));
    if (rating < 1 || rating > 5) {
      return { success: false, message: 'Rating must be between 1 and 5.' };
    }

    try {
      await this.databaseService.query(
        `INSERT INTO tblfeedback (rating, would_recommend, insights, name)
         VALUES ($1, $2, $3, $4)`,
        [
          rating,
          Boolean(dto.wouldRecommend),
          String(dto.insights ?? '').trim() || null,
          String(dto.name ?? '').trim() || null,
        ],
      );
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
