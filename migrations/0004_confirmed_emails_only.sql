-- Emails count only once their owner confirmed them with a code (owner's
-- decision, 2026-10-28): registering takes a username and a password, and
-- an email is added later in account settings, by code. Accounts registered
-- before with an email that was never confirmed lose it: they add it again
-- in account settings. Each gets a made-up address instead (never shown,
-- never used; worker/accounts.js does the same for new accounts).

UPDATE "user"
SET email = lower(hex(randomblob(16))) || '@account.invalid'
WHERE "emailVerified" = 0
  AND ("isAnonymous" IS NULL OR "isAnonymous" = 0)
  AND email NOT LIKE '%.invalid';
