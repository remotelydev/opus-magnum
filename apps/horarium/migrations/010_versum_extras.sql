-- What Versum keeps on a card besides the personal data: entries of the dental diagram, and the
-- photos and files attached to the card. Both come only from the Versum import for now; the app shows
-- them on the patient card and does not edit them.

-- One entry of Versum's "diagram uzębienia": a diagnosis and/or treatment on a tooth (or one surface).
CREATE TABLE IF NOT EXISTS patient_dental_entries (
  id           serial PRIMARY KEY,
  patient_id   integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth        smallint NOT NULL,                 -- FDI number, e.g. 16, 47
  surface      text,                              -- Versum's surface code, e.g. "16kor" (crown), "26P1"
  diagnosis    text,                              -- e.g. "Próchnica"
  treatment    text,                              -- e.g. "Wypełnienie ubytku ostateczne"
  doctor_name  text,                              -- as Versum shows it; staff are not linked
  description  text,
  color        text,                              -- the colour Versum draws the entry in, "#rrggbb"
  recorded_at  timestamptz NOT NULL,
  import_data  jsonb
);
CREATE INDEX IF NOT EXISTS patient_dental_entries_patient_idx ON patient_dental_entries (patient_id, recorded_at);

-- A photo from the card's gallery or an attached file, stored in the database itself so a backup of the
-- database holds everything.
CREATE TABLE IF NOT EXISTS patient_attachments (
  id            serial PRIMARY KEY,
  patient_id    integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('photo', 'file')),
  name          text NOT NULL,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  size          integer NOT NULL,
  data          bytea NOT NULL,
  description   text,
  added_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_attachments_patient_idx ON patient_attachments (patient_id, added_at);
