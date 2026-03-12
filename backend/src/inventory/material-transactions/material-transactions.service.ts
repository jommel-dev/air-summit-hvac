import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { MaterialsService } from '../materials/materials.service';
import { MaterialStockService } from '../material-stock/material-stock.service';
import { CreateMaterialTransactionDto } from './dto/create-material-transaction.dto';

@Injectable()
export class MaterialTransactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly materialsService: MaterialsService,
    private readonly materialStockService: MaterialStockService,
  ) {}

  // Create a single material transaction item (atomic: insert + stock update)
  async create(dto: CreateMaterialTransactionDto) {
    return this.db.withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO tbltransaction_material_items 
         (trans_type, material_id, quantity, unit_price, sell_price, discount_price, purchase_id, sales_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          dto.trans_type,
          dto.material_id,
          dto.quantity,
          dto.unit_price || 0,
          dto.sell_price || 0,
          dto.discount_price || 0,
          dto.purchase_id || null,
          dto.sales_id || null,
        ],
      );

      const result = res.rows[0] || null;

      // Only update stock when we have a successful transaction record
      if (result) {
        const qty = Number(dto.quantity || 0);
        const isSalesTxn = dto.trans_type === 'sales' || (!!dto.sales_id && !dto.trans_type);
        const isPurchaseTxn = dto.trans_type === 'purchase' || (!!dto.purchase_id && !dto.trans_type);

        // Adjust on-hand stock based on transaction type
        if (isSalesTxn) {
          // Deduct stock (negative quantity)
          await this.materialsService.updateStock(dto.material_id, -qty, null, { client });
        } else if (isPurchaseTxn) {
          // Increase stock
          await this.materialsService.updateStock(dto.material_id, qty, null, { client });
        }

        // Record a corresponding stock movement for audit / ledger
        const movementType = isSalesTxn ? 'OUT' : isPurchaseTxn ? 'IN' : 'ADJUST';
        const sourceType = isSalesTxn ? 'SO' : isPurchaseTxn ? 'PO' : 'MANUAL';
        const sourceId = isSalesTxn ? Number(dto.sales_id ?? 0) : isPurchaseTxn ? Number(dto.purchase_id ?? 0) : 0;

        await this.materialStockService.recordMovement(
          {
            materialId: dto.material_id,
            movementType,
            qty,
            sourceType,
            sourceId,
            sourceLineKey: `mt-${result.id}`,
            statusSnapshot: JSON.stringify(result),
          },
          { client },
        );
      }

      return result;
    });
  }

  // Create multiple material transaction items in a single transaction (atomic)
  async createMany(dtos: CreateMaterialTransactionDto[]) {
    if (!Array.isArray(dtos) || dtos.length === 0) {
      return [];
    }

    return this.db.withTransaction(async (client) => {
      const created: any[] = [];

      for (const dto of dtos) {
        const res = await client.query(
          `INSERT INTO tbltransaction_material_items 
           (trans_type, material_id, quantity, unit_price, sell_price, discount_price, purchase_id, sales_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            dto.trans_type,
            dto.material_id,
            dto.quantity,
            dto.unit_price || 0,
            dto.sell_price || 0,
            dto.discount_price || 0,
            dto.purchase_id || null,
            dto.sales_id || null,
          ],
        );

        const createdItem = res.rows[0];
        if (createdItem) {
          created.push(createdItem);

          const qty = Number(dto.quantity || 0);
          const isSalesTxn = dto.trans_type === 'sales' || (!!dto.sales_id && !dto.trans_type);
          const isPurchaseTxn = dto.trans_type === 'purchase' || (!!dto.purchase_id && !dto.trans_type);

          if (isSalesTxn) {
            await this.materialsService.updateStock(dto.material_id, -qty, null, { client });
          } else if (isPurchaseTxn) {
            await this.materialsService.updateStock(dto.material_id, qty, null, { client });
          }

          const movementType = isSalesTxn ? 'OUT' : isPurchaseTxn ? 'IN' : 'ADJUST';
          const sourceType = isSalesTxn ? 'SO' : isPurchaseTxn ? 'PO' : 'MANUAL';
          const sourceId = isSalesTxn ? Number(dto.sales_id ?? 0) : isPurchaseTxn ? Number(dto.purchase_id ?? 0) : 0;

          await this.materialStockService.recordMovement(
            {
              materialId: dto.material_id,
              movementType,
              qty,
              sourceType,
              sourceId,
              sourceLineKey: `mt-${createdItem.id}`,
              statusSnapshot: JSON.stringify(createdItem),
            },
            { client },
          );
        }
      }

      return created;
    });
  }

  // Get all material transactions for a purchase order
  async findByPurchaseId(purchaseId: number) {
    const res = await this.db.query(
      `SELECT tmi.*, m.material_name, m.material_code, m.unit
       FROM tbltransaction_material_items tmi
       LEFT JOIN tblmaterials m ON m.id = tmi.material_id
       WHERE tmi.purchase_id = $1 AND tmi.trans_type = 'purchase'
       ORDER BY tmi.id DESC`,
      [purchaseId],
    );
    return res.rows;
  }

  // Get all material transactions for a sales order
  async findBySalesId(salesId: number) {
    const res = await this.db.query(
      `SELECT tmi.*, m.material_name, m.material_code, m.unit
       FROM tbltransaction_material_items tmi
       LEFT JOIN tblmaterials m ON m.id = tmi.material_id
       WHERE tmi.sales_id = $1 AND tmi.trans_type = 'sales'
       ORDER BY tmi.id DESC`,
      [salesId],
    );
    return res.rows;
  }

  // Delete material transaction item
  async remove(id: number) {
    const res = await this.db.query(
      `DELETE FROM tbltransaction_material_items WHERE id = $1 RETURNING id`,
      [id],
    );
    return res.rows[0] || null;
  }

  // Get transaction by ID
  async findOne(id: number) {
    const res = await this.db.query(
      `SELECT tmi.*, m.material_name, m.material_code, m.unit
       FROM tbltransaction_material_items tmi
       LEFT JOIN tblmaterials m ON m.id = tmi.material_id
       WHERE tmi.id = $1`,
      [id],
    );
    return res.rows[0] || null;
  }
}
