-- Statistics as in Versum: what was done and paid at a visit, the cash register, a hygienist role and
-- per-login feature flags.

-- Hygienists get their own role (no statistics, no booking). Reception already has one.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'reception', 'doctor', 'hygienist'));

-- Features switched on for one login only, e.g. 'hidden_reports' (reports the clinic does not use yet).
ALTER TABLE users ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';

-- Services done at a visit, with the price charged. Filled when reception closes the visit; the price
-- starts from the price list and may be changed. The name is kept as it was on the day.
CREATE TABLE IF NOT EXISTS appointment_services (
  id              serial PRIMARY KEY,
  appointment_id  integer NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id      integer REFERENCES services(id) ON DELETE SET NULL,
  name            text NOT NULL,
  price           numeric(10, 2) NOT NULL CHECK (price >= 0),
  position        smallint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS appointment_services_appointment_idx ON appointment_services (appointment_id);
CREATE INDEX IF NOT EXISTS appointment_services_service_idx ON appointment_services (service_id);

CREATE INDEX IF NOT EXISTS appointments_status_time_idx ON appointments (status, starts_at);

-- The cash register of each clinic ("Stan kasy"). Cash taken at visits comes from appointment_payments;
-- this table holds what reception enters by hand: money put in or taken out, and the counted balance
-- when the register is opened or closed.
CREATE TABLE IF NOT EXISTS cash_operations (
  id          serial PRIMARY KEY,
  site_id     text NOT NULL REFERENCES sites(id),
  kind        text NOT NULL CHECK (kind IN ('in', 'out', 'open', 'close')),
  amount      numeric(10, 2) NOT NULL CHECK (amount >= 0),   -- for open/close: the counted balance
  note        text,
  user_id     integer REFERENCES users(id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_operations_site_idx ON cash_operations (site_id, at);

-- When the money was taken and who took it (desk payments). Imported payments have neither: the visit's
-- start stands in for the time.
ALTER TABLE appointment_payments
  ADD COLUMN IF NOT EXISTS paid_at  timestamptz,
  ADD COLUMN IF NOT EXISTS user_id  integer REFERENCES users(id);
