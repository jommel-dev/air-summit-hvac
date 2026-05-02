-- Run this in your Supabase SQL editor
CREATE TABLE IF NOT EXISTS tblfeedback (
  id BIGSERIAL PRIMARY KEY,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  would_recommend BOOLEAN NOT NULL DEFAULT true,
  insights TEXT,
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
