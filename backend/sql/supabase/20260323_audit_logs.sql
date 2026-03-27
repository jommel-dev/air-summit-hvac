-- ============================================================
-- Audit Logs Table
-- Records user actions on core entities for traceability
-- ============================================================

CREATE TABLE IF NOT EXISTS tblaudit_logs (
  id              BIGSERIAL PRIMARY KEY,
  action          VARCHAR(100) NOT NULL,          -- e.g. 'PURCHASE_CANCEL', 'PURCHASE_DELETE'
  entity_type     VARCHAR(100) NOT NULL,          -- e.g. 'purchase_order', 'quotation'
  entity_id       VARCHAR(100),                   -- the PK of the affected row
  user_id         INTEGER,                        -- JWT sub (actor)
  username        VARCHAR(150),                   -- actor username
  role_name       VARCHAR(100),                   -- actor role at time of action
  branch_id       INTEGER,
  ip_address      VARCHAR(60),
  metadata        JSONB,                          -- optional extra data (po_number, reason, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON tblaudit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON tblaudit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON tblaudit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON tblaudit_logs (created_at DESC);
