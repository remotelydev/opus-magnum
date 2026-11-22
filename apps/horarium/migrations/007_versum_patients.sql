-- Patient card fields that Versum keeps and Horarium did not, so the Versum import loses nothing.
-- `description` is Versum's "Opis" (a free note about the patient, kept apart from reception's
-- organisational `notes`). `import_data` holds the whole source record as exported, for anything not
-- mapped to a column; the app only shows it, never edits it, and it can be dropped later.
ALTER TABLE patients
  ADD COLUMN description            text,
  ADD COLUMN gender                 text CHECK (gender IN ('female', 'male')),
  ADD COLUMN pesel                  text,
  ADD COLUMN card_number            text,            -- "Numer karty" in Versum
  ADD COLUMN tax_id                 text,            -- NIP, for invoices
  ADD COLUMN street                 text,
  ADD COLUMN house_number           text,
  ADD COLUMN unit_number            text,
  ADD COLUMN postal_code            text,
  ADD COLUMN city                   text,
  ADD COLUMN province               text,            -- województwo, as a name
  ADD COLUMN country                text,            -- ISO 3166-1 alpha-2, e.g. PL
  ADD COLUMN name_day               text CHECK (name_day ~ '^\d{2}-\d{2}$'),  -- "MM-DD"
  ADD COLUMN patient_groups         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN origin                 text,            -- "Pochodzenie klienta", e.g. "Polecenie przez innego klienta"
  ADD COLUMN referred_by_patient_id integer REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN email_consent          boolean NOT NULL DEFAULT false,  -- reminders by e-mail
  ADD COLUMN marketing_consent      boolean NOT NULL DEFAULT false,  -- commercial information by SMS / e-mail
  ADD COLUMN import_data            jsonb;

CREATE INDEX patients_pesel_idx ON patients (pesel) WHERE pesel IS NOT NULL;
CREATE INDEX patients_card_number_idx ON patients (card_number) WHERE card_number IS NOT NULL;
