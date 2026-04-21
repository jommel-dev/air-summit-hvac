-- Migration: Add projects menu RBAC permissions
-- Date: 2026-04-18
-- Purpose: Add RBAC permissions for the new projects menu

BEGIN;

-- Add projects menu permissions
INSERT INTO public.auth_permission_keys(key, label, module, scope)
VALUES
  ('projects.view', 'View Projects', 'projects', 'feature'),
  ('projects.create', 'Create Project', 'projects', 'action'),
  ('projects.edit', 'Edit Project', 'projects', 'action'),
  ('projects.delete', 'Delete Project', 'projects', 'action')
ON CONFLICT (key) DO NOTHING;

-- Add legacy menu entry for backward compatibility
INSERT INTO public.auth_permission_keys(key, label, module, scope)
VALUES
  ('legacy.menu.projects', 'Legacy Menu: Projects', 'legacy', 'menu')
ON CONFLICT (key) DO NOTHING;

COMMIT;