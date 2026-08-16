type Queryable = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export type PendingCatalogAlertItem = {
  productId: number | null;
  capacityId: number | null;
  productName: string;
  capacityName: string;
  productDeleted: boolean;
  capacityDeleted: boolean;
};

export type PendingCatalogAlert = {
  orderType: 'sales' | 'purchase';
  id: number;
  orderNumber: string;
  status: string;
  items: PendingCatalogAlertItem[];
};

export function catalogActiveSql(alias: string): string {
  return `NULLIF(BTRIM(COALESCE(to_jsonb(${alias})->>'deleted_at', '')), '') IS NULL`;
}

export function catalogDeletedSql(alias: string): string {
  return `NULLIF(BTRIM(COALESCE(to_jsonb(${alias})->>'deleted_at', '')), '') IS NOT NULL`;
}

export function pendingWorkflowStatusSql(alias: string): string {
  return `REPLACE(REPLACE(LOWER(BTRIM(COALESCE(${alias}.status, 'pending'))), '_', '-'), ' ', '-') IN (
    'pending',
    'for-delivery',
    'in-progress',
    'scheduled',
    'for-approval',
    'pending-approval'
  )`;
}

export async function assertActiveProductCapacity(
  executor: Queryable,
  productId: number,
  capacityId: number,
): Promise<void> {
  const result = await executor.query<{
    product_missing: boolean;
    product_deleted: boolean;
    capacity_missing: boolean;
    capacity_deleted: boolean;
  }>(
    `SELECT
       (p.id IS NULL) AS product_missing,
       (${catalogDeletedSql('p')}) AS product_deleted,
       (c.id IS NULL) AS capacity_missing,
       (${catalogDeletedSql('c')}) AS capacity_deleted
     FROM (SELECT $1::bigint AS product_id, $2::bigint AS capacity_id) AS ids
     LEFT JOIN tblproducts p ON p.id = ids.product_id
     LEFT JOIN tblcapacity c ON c.id = ids.capacity_id
     LIMIT 1`,
    [productId, capacityId],
  );

  const row = result.rows[0];
  if (!row || row.product_missing) {
    throw new Error(`Product ID ${productId} does not exist`);
  }
  if (row.product_deleted) {
    throw new Error(
      'A selected product has been deleted. Choose another product on this pending order.',
    );
  }
  if (row.capacity_missing) {
    throw new Error(`Capacity ID ${capacityId} does not exist`);
  }
  if (row.capacity_deleted) {
    throw new Error(
      'A selected capacity has been deleted. Choose another capacity on this pending order.',
    );
  }
}

export async function findPendingCatalogAlerts(
  executor: Queryable,
  options?: { productId?: number; capacityId?: number },
): Promise<PendingCatalogAlert[]> {
  const productId =
    Number.isFinite(Number(options?.productId)) && Number(options?.productId) > 0
      ? Number(options?.productId)
      : null;
  const capacityId =
    Number.isFinite(Number(options?.capacityId)) && Number(options?.capacityId) > 0
      ? Number(options?.capacityId)
      : null;

  const result = await executor.query<{
    order_type: 'sales' | 'purchase';
    id: number;
    order_number: string | null;
    status: string | null;
    product_id: string | null;
    capacity_id: string | null;
    product_name: string | null;
    capacity_name: string | null;
    product_deleted: boolean;
    capacity_deleted: boolean;
  }>(
    `SELECT
       'sales'::text AS order_type,
       so.id,
       COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', so.id::text) AS order_number,
       COALESCE(so.status, 'pending') AS status,
       COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') AS product_id,
       COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') AS capacity_id,
       COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', 'Unknown product') AS product_name,
       COALESCE(to_jsonb(c)->>'capacity', '') AS capacity_name,
       (${catalogDeletedSql('p')} OR p.id IS NULL) AS product_deleted,
       (${catalogDeletedSql('c')} OR c.id IS NULL) AS capacity_deleted
     FROM tbltransaction_product_items tpi
     INNER JOIN tblsales_order so
       ON so.id::text = COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id')
     LEFT JOIN tblproducts p
       ON p.id::text = COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id')
     LEFT JOIN tblcapacity c
       ON c.id::text = COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id')
     WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
       AND ${pendingWorkflowStatusSql('so')}
       AND ($1::bigint IS NULL OR COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') = $1::text)
       AND ($2::bigint IS NULL OR COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') = $2::text)
       AND (
         $1::bigint IS NOT NULL
         OR $2::bigint IS NOT NULL
         OR ${catalogDeletedSql('p')}
         OR ${catalogDeletedSql('c')}
         OR p.id IS NULL
         OR c.id IS NULL
       )

     UNION ALL

     SELECT
       'purchase'::text AS order_type,
       po.id,
       COALESCE(to_jsonb(po)->>'po_number', to_jsonb(po)->>'poNumber', po.id::text) AS order_number,
       COALESCE(po.status, 'pending') AS status,
       COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') AS product_id,
       COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') AS capacity_id,
       COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', 'Unknown product') AS product_name,
       COALESCE(to_jsonb(c)->>'capacity', '') AS capacity_name,
       (${catalogDeletedSql('p')} OR p.id IS NULL) AS product_deleted,
       (${catalogDeletedSql('c')} OR c.id IS NULL) AS capacity_deleted
     FROM tbltransaction_product_items tpi
     INNER JOIN tblpurchase_orders po
       ON po.id::text = COALESCE(
         to_jsonb(tpi)->>'purchaseId',
         to_jsonb(tpi)->>'purchase_id',
         to_jsonb(tpi)->>'po_id'
       )
     LEFT JOIN tblproducts p
       ON p.id::text = COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id')
     LEFT JOIN tblcapacity c
       ON c.id::text = COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id')
     WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'purchase')) = 'purchase'
       AND ${pendingWorkflowStatusSql('po')}
       AND ($1::bigint IS NULL OR COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') = $1::text)
       AND ($2::bigint IS NULL OR COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') = $2::text)
       AND (
         $1::bigint IS NOT NULL
         OR $2::bigint IS NOT NULL
         OR ${catalogDeletedSql('p')}
         OR ${catalogDeletedSql('c')}
         OR p.id IS NULL
         OR c.id IS NULL
       )
     ORDER BY order_type, id DESC`,
    [productId, capacityId],
  );

  const grouped = new Map<string, PendingCatalogAlert>();

  for (const row of result.rows) {
    const productDeleted = Boolean(row.product_deleted);
    const capacityDeleted = Boolean(row.capacity_deleted);
    if (!productDeleted && !capacityDeleted && productId === null && capacityId === null) {
      continue;
    }

    const key = `${row.order_type}:${row.id}`;
    const existing = grouped.get(key);
    const item: PendingCatalogAlertItem = {
      productId: Number.isFinite(Number(row.product_id)) ? Number(row.product_id) : null,
      capacityId: Number.isFinite(Number(row.capacity_id)) ? Number(row.capacity_id) : null,
      productName: String(row.product_name ?? 'Unknown product').trim() || 'Unknown product',
      capacityName: String(row.capacity_name ?? '').trim(),
      productDeleted,
      capacityDeleted,
    };

    if (existing) {
      existing.items.push(item);
      continue;
    }

    grouped.set(key, {
      orderType: row.order_type,
      id: row.id,
      orderNumber: String(row.order_number ?? row.id).trim() || String(row.id),
      status: String(row.status ?? 'pending'),
      items: [item],
    });
  }

  return [...grouped.values()];
}
