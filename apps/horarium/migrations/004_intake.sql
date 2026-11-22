-- Patient registration on the clinic iPads ("Formularz rejestracyjny").

-- A tablet paired by reception. It holds only a long random token (HttpOnly cookie) that lets it
-- show the form and send answers: it cannot read anything back. Revoking stops it at once.
CREATE TABLE kiosk_devices (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  site_id       text NOT NULL REFERENCES sites(id),
  token_hash    text NOT NULL UNIQUE,
  created_by    integer REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

-- What a patient filled in. Waits for reception, who creates a patient card from it or attaches it
-- to an existing one. Answers are kept as given (the signed-off questionnaire); the name, phone and
-- birth date are copied out for the list and for finding a matching card.
CREATE TABLE intake_submissions (
  id            serial PRIMARY KEY,
  device_id     integer REFERENCES kiosk_devices(id),
  site_id       text NOT NULL REFERENCES sites(id),
  form_version  text NOT NULL,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  phone         text,
  birth_date    date,
  answers       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted')),
  patient_id    integer REFERENCES patients(id),
  reviewed_by   integer REFERENCES users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'new' OR patient_id IS NOT NULL)
);
CREATE INDEX intake_submissions_status_idx ON intake_submissions (status, created_at DESC);
CREATE INDEX intake_submissions_device_idx ON intake_submissions (device_id, created_at);
