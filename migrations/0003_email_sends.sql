-- Codes sent by email (worker/email.js). The owner pays for no email
-- (2026-10-27): the site sends through a free plan and caps itself well
-- below it, per address and per day. One row per email sent; rows older
-- than two days are dropped as new ones come in.

CREATE TABLE email_send (
  id integer primary key autoincrement,
  address text not null,
  sent_at integer not null
);

CREATE INDEX email_send_address on email_send (address, sent_at);
CREATE INDEX email_send_time on email_send (sent_at);
