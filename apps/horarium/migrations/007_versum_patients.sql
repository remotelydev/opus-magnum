-- Patient card fields that Versum keeps and Horarium did not, so the Versum import loses nothing.
-- `description` is Versum's "Opis" (a free note about the patient, kept apart from reception's
-- organisational `notes`). `import_data` holds the whole source record as exported, for anything not
-- mapped to a column; the app only shows it, never edits it, and it can be dropped later.
-- Idempotent: the preview database may already have these columns from this migration's earlier name (006).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS description            text,
  ADD COLUMN IF NOT EXISTS gender                 text CHECK (gender IN ('female', 'male')),
  ADD COLUMN IF NOT EXISTS pesel                  text,
  ADD COLUMN IF NOT EXISTS card_number            text,            -- "Numer karty" in Versum
  ADD COLUMN IF NOT EXISTS tax_id                 text,            -- NIP, for invoices
  ADD COLUMN IF NOT EXISTS street                 text,
  ADD COLUMN IF NOT EXISTS house_number           text,
  ADD COLUMN IF NOT EXISTS unit_number            text,
  ADD COLUMN IF NOT EXISTS postal_code            text,
  ADD COLUMN IF NOT EXISTS city                   text,
  ADD COLUMN IF NOT EXISTS province               text,            -- województwo, as a name
  ADD COLUMN IF NOT EXISTS country                text,            -- ISO 3166-1 alpha-2, e.g. PL
  ADD COLUMN IF NOT EXISTS name_day               text CHECK (name_day ~ '^\d{2}-\d{2}$'),  -- "MM-DD"
  ADD COLUMN IF NOT EXISTS patient_groups         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS origin                 text,            -- "Pochodzenie klienta", e.g. "Polecenie przez innego klienta"
  ADD COLUMN IF NOT EXISTS referred_by_patient_id integer REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_consent          boolean NOT NULL DEFAULT false,  -- reminders by e-mail
  ADD COLUMN IF NOT EXISTS marketing_consent      boolean NOT NULL DEFAULT false,  -- commercial information by SMS / e-mail
  ADD COLUMN IF NOT EXISTS import_data            jsonb;

CREATE INDEX IF NOT EXISTS patients_pesel_idx ON patients (pesel) WHERE pesel IS NOT NULL;
CREATE INDEX IF NOT EXISTS patients_card_number_idx ON patients (card_number) WHERE card_number IS NOT NULL;
