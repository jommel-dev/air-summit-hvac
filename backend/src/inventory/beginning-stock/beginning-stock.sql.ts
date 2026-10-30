import { BEGINNING_STOCK_EXCLUDED_STATUSES } from './beginning-stock.rules';

const EXCLUDED_STATUS_LIST = BEGINNING_STOCK_EXCLUDED_STATUSES.map((status) => `'${status}'`).join(
  ', ',
);

const NORMALIZED_STATUS_SQL = `
  regexp_replace(
    regexp_replace(lower(btrim(COALESCE(sn.status, ''))), '_', '-', 'g'),
    '[[:space:]]+',
    '-',
    'g'
  )
`;

const NORMALIZED_UNIT_TYPE_SQL = `
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(COALESCE(sn."unitType", ''))), '[[:space:]]+', ' ', 'g'),
        '[[:space:]_-]*qty$',
        '',
        'i'
      ),
      'quantity$',
      '',
      'i'
    )
  )
`;

export const BEGINNING_STOCK_INSERT_SQL = `
  INSERT INTO tblbeginning_stock (
    snapshot_date,
    brand_id,
    brand_name,
    product_id,
    product_name,
    capacity_id,
    capacity_name,
    indoor_stock,
    outdoor_stock,
    window_stock,
    panel_stock,
    other_stock
  )
  WITH in_stock AS (
    SELECT
      sn."capacityId" AS capacity_id,
      CASE
        WHEN ${NORMALIZED_UNIT_TYPE_SQL} LIKE '%indoor%' THEN 'indoor'
        WHEN ${NORMALIZED_UNIT_TYPE_SQL} LIKE '%outdoor%' THEN 'outdoor'
        WHEN ${NORMALIZED_UNIT_TYPE_SQL} LIKE '%window%' THEN 'window'
        WHEN ${NORMALIZED_UNIT_TYPE_SQL} LIKE '%panel%' THEN 'panel'
        ELSE 'other'
      END AS unit_bucket
    FROM tblserial_numbers sn
    WHERE sn."capacityId" IS NOT NULL
      AND NOT COALESCE(sn."isDefective", false)
      AND ${NORMALIZED_STATUS_SQL} NOT IN (${EXCLUDED_STATUS_LIST})
  ),
  counts AS (
    SELECT
      capacity_id,
      COUNT(*) FILTER (WHERE unit_bucket = 'indoor')::int AS indoor_stock,
      COUNT(*) FILTER (WHERE unit_bucket = 'outdoor')::int AS outdoor_stock,
      COUNT(*) FILTER (WHERE unit_bucket = 'window')::int AS window_stock,
      COUNT(*) FILTER (WHERE unit_bucket = 'panel')::int AS panel_stock,
      COUNT(*) FILTER (WHERE unit_bucket = 'other')::int AS other_stock,
      COUNT(*)::int AS total_in_stock
    FROM in_stock
    GROUP BY capacity_id
  )
  SELECT
    $1::date,
    b.id,
    NULLIF(btrim(COALESCE(b."brandName", '')), ''),
    p.id,
    NULLIF(btrim(COALESCE(p."productName", '')), ''),
    c.id,
    NULLIF(btrim(COALESCE(c.capacity, '')), ''),
    COALESCE(counts.indoor_stock, 0),
    COALESCE(counts.outdoor_stock, 0),
    COALESCE(counts.window_stock, 0),
    COALESCE(counts.panel_stock, 0),
    COALESCE(counts.other_stock, 0)
  FROM tblcapacity c
  JOIN tblproducts p ON p.id = c."prodId"
  LEFT JOIN tblbrands b ON b.id = p."brandId"
  LEFT JOIN counts ON counts.capacity_id = c.id
  WHERE (b.id IS NULL OR COALESCE(b.type, 'ACU') = 'ACU')
    AND (
      (
        c.deleted_at IS NULL
        AND (p.deleted_at IS NULL OR btrim(p.deleted_at::text) = '')
      )
      OR COALESCE(counts.total_in_stock, 0) > 0
    )
`;
