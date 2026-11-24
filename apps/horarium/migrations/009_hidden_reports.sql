-- Reports the clinic does not use yet, seen only by logins with the 'hidden_reports' feature:
-- client origins (patients.origin, already imported from Versum) and staff commissions.

-- Commission of a staff member, as a percentage of what was paid for their visits. One current rate;
-- the report applies it to the whole period it covers.
CREATE TABLE IF NOT EXISTS staff_commissions (
  staff_id    integer PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  rate        numeric(5, 2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  updated_by  integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patients_origin_idx ON patients (origin) WHERE origin IS NOT NULL;
