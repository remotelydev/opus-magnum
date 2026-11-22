-- Visit history imported from Versum: a historical "deleted" status, Versum's tags, payments and the raw
-- Versum records, so nothing from the old system is lost.

-- "deleted": a visit someone removed in Versum. Kept only for the record, shown in the history, never in
-- the calendar, and it never blocks a slot.
ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'done', 'deleted'));

ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(starts_at, ends_at) WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show', 'deleted'));

-- Labels on a visit, as in Versum ("pierwsza wizyta", "obecny", "sms", ...).
ALTER TABLE appointments ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

-- Money taken for a visit. Admins only.
CREATE TABLE appointment_payments (
  id              serial PRIMARY KEY,
  appointment_id  integer NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  method          text NOT NULL,            -- Versum: cash, transfer, card, ...
  method_label    text,                     -- as Versum shows it, e.g. "gotówka"
  amount          numeric(10, 2) NOT NULL,
  source          text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'import'))
);
CREATE INDEX appointment_payments_appointment_idx ON appointment_payments (appointment_id);

-- The source records of an import, kept whole (JSON as Versum returned it), so a field the import does
-- not map yet can still be recovered later. Not used by the app.
CREATE TABLE import_raw (
  source      text NOT NULL,              -- "versum"
  entity      text NOT NULL,              -- "appointment", "appointment_versions"
  source_id   text NOT NULL,
  data        jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, entity, source_id)
);
