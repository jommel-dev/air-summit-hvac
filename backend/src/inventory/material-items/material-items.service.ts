import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

@Injectable()
export class MaterialItemsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async addMaterial(
    dto: { code: string; name: string; unit?: string },
    auditActor?: AuditActorContext,
  ) {
    const unit = dto.unit || 'pcs';
    const res = await this.db.query(
      `INSERT INTO tblmaterial_items (code, name, unit) VALUES ($1, $2, $3) RETURNING *`,
      [dto.code, dto.name, unit],
    );
    const created = res.rows[0] ?? null;
    if (created) {
      await this.auditLogService.logMutation({
        action: 'MATERIAL_ITEM_CREATE',
        entityType: 'material-item',
        entityId: created.id,
        actor: auditActor,
        description: `Created material item ${created.code ?? created.name ?? created.id}`,
        requestBody: dto as unknown as Record<string, unknown>,
        after: created as Record<string, unknown>,
      });
    }
    return created;
  }

  async listMaterials() {
    const res = await this.db.query(
      `SELECT id, code, name, unit, is_active, created_at FROM tblmaterial_items ORDER BY id DESC`,
    );
    return res.rows;
  }

  async getMaterial(id: number) {
    const res = await this.db.query(
      `SELECT id, code, name, unit, is_active, created_at FROM tblmaterial_items WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async updateMaterial(
    id: number,
    dto: { code?: string; name?: string; unit?: string },
    auditActor?: AuditActorContext,
  ) {
    const fields = [];
    const values: any[] = [];
    let idx = 1;
    // if (dto.code !== undefined) {
    //   fields.push(`code = $${idx++}`);
    //   values.push(dto.code);
    // }
    // if (dto.name !== undefined) {
    //   fields.push(`name = $${idx++}`);
    //   values.push(dto.name);
    // }
    // if (dto.unit !== undefined) {
    //   fields.push(`unit = $${idx++}`);
    //   values.push(dto.unit);
    // }
    if (fields.length === 0) {
      return { success: false, message: 'No fields to update' };
    }
    values.push(id);
    const q = `UPDATE tblmaterial_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const res = await this.db.query(q, values);
    const updated = res.rows[0] ?? null;
    if (updated) {
      await this.auditLogService.logMutation({
        action: 'MATERIAL_ITEM_UPDATE',
        entityType: 'material-item',
        entityId: id,
        actor: auditActor,
        description: `Updated material item #${id}`,
        requestBody: dto as unknown as Record<string, unknown>,
        after: updated as Record<string, unknown>,
      });
    }
    return updated;
  }

  async deleteMaterial(id: number, auditActor?: AuditActorContext) {
    // Soft-delete
    const res = await this.db.query(
      `UPDATE tblmaterial_items SET is_active = false WHERE id = $1 RETURNING id, code, name, is_active`,
      [id],
    );
    const deleted = res.rows[0] ?? null;
    if (deleted) {
      await this.auditLogService.logMutation({
        action: 'MATERIAL_ITEM_DELETE',
        entityType: 'material-item',
        entityId: id,
        actor: auditActor,
        description: `Deleted material item ${deleted.code ?? deleted.name ?? id}`,
        after: deleted as Record<string, unknown>,
      });
    }
    return deleted;
  }
}
