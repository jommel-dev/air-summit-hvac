-- Migration: update concern_status check constraint to include new service/concern statuses
-- New allowed values: in-progress, reschedule, pulled-out, warranty, void-warranty, complete
-- Also keeps legacy values: open, in_progress, resolved, closed

ALTER TABLE tblconcern_details
  DROP CONSTRAINT IF EXISTS tblconcern_details_concern_status_check;

ALTER TABLE tblconcern_details
  ADD CONSTRAINT tblconcern_details_concern_status_check
  CHECK (concern_status IN (
    'open', 'in_progress', 'resolved', 'closed',
    'in-progress', 'reschedule', 'pulled-out', 'warranty', 'void-warranty', 'complete',
    ''
  ));
