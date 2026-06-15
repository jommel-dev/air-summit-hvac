-- Migration: Add database backup logs table
-- Tracks all database backups initiated from the Settings module

CREATE TABLE IF NOT EXISTS tbl_backup_logs (
  id SERIAL PRIMARY KEY,
  backup_type VARCHAR(50) NOT NULL,           -- 'full', 'data_only', 'schema_only'
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'in_progress',  -- 'in_progress', 'completed', 'failed'
  error_message TEXT,
  initiated_by INTEGER REFERENCES tblusers(id),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_started_at ON tbl_backup_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON tbl_backup_logs(status);
