-- Reset FAILED posts to APPROVED so they are retried
-- Only reset posts failed in the last 24 hours
-- (older posts may be intentionally failed)
UPDATE social_posts
SET
  status = 'APPROVED',
  publish_error = NULL,
  updated_at = now()
WHERE
  status = 'FAILED'
  AND created_at >= now() - INTERVAL '24 hours';

-- Confirm how many were reset
SELECT COUNT(*) as reset_count
FROM social_posts
WHERE status = 'APPROVED'
AND publish_error IS NULL;
