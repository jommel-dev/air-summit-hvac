import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

@Injectable()
export class MaterialItemsService {
  async addMaterial(dto: { code: string; name: string; unit?: string }, executor?: PoolClient) {
    const unit = dto.unit || 'pcs';
    // Use query builder or raw SQL as appropriate
    const result = await executor?.query(
      `INSERT INTO tblmaterial_items (code, name, unit) VALUES ($1, $2, $3) RETURNING *`,
      [dto.code, dto.name, unit]
    );
    return result?.rows[0] || null;
  }
}
