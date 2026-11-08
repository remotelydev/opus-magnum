-- Core schema: sites, staff, logins, services, patients, working hours, appointments, change log.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE sites (
  id          text PRIMARY KEY,            -- "turek", "poddebice"
  name        text NOT NULL
);

-- People who can have a calendar column (doctors, hygienists, "Higieny" pseudo-calendar).
CREATE TABLE staff (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'calendar')),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE staff_sites (
  staff_id    integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  site_id     text NOT NULL REFERENCES sites(id),
  PRIMARY KEY (staff_id, site_id)
);

-- One login per person. No shared desk account.
CREATE TABLE users (
  id            serial PRIMARY KEY,
  login         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'reception', 'doctor')),
  password_hash text NOT NULL,
  staff_id      integer REFERENCES staff(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

-- One price list for the desk, the bot and the clinic website.
CREATE TABLE services (
  id                serial PRIMARY KEY,
  category          text NOT NULL,
  name              text NOT NULL,
  description       text,
  duration_minutes  integer NOT NULL CHECK (duration_minutes > 0),
  price_min         numeric(10, 2) CHECK (price_min >= 0),
  price_max         numeric(10, 2) CHECK (price_max >= price_min),
  price_note        text,                         -- e.g. "za ząb", "od"
  show_online       boolean NOT NULL DEFAULT true, -- listed on the website price list
  sort_order        integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id              serial PRIMARY KEY,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  phone           text,                 -- E.164, e.g. +48600100200
  email           text,
  birth_date      date,
  medical_flags   text[] NOT NULL DEFAULT '{}',
  notes           text,
  sms_consent     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_phone_idx ON patients (phone);
CREATE INDEX patients_name_idx ON patients (lower(last_name), lower(first_name));

-- Working hours: one row per staff member, site and date range block.
CREATE TABLE schedules (
  id          serial PRIMARY KEY,
  staff_id    integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  site_id     text NOT NULL REFERENCES sites(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        text NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'absence')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX schedules_staff_time_idx ON schedules (staff_id, starts_at);

CREATE TABLE appointments (
  id            serial PRIMARY KEY,
  site_id       text NOT NULL REFERENCES sites(id),
  staff_id      integer NOT NULL REFERENCES staff(id),
  patient_id    integer REFERENCES patients(id),   -- null for a block ("przerwa")
  service_id    integer REFERENCES services(id),   -- null for "usługa spoza cennika"
  title         text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'done')),
  source        text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'bot', 'import')),
  notes         text,
  created_by    integer REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- One staff member cannot have two live appointments at the same time.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);
CREATE INDEX appointments_site_time_idx ON appointments (site_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id, starts_at);

-- Links rows to ids in a data source during a one-off import (so re-running it updates instead of
-- duplicating). Not used by the app; can be emptied or dropped once the import is finished.
CREATE TABLE import_refs (
  source      text NOT NULL,           -- name of the import batch / source system
  entity      text NOT NULL,           -- "patient", "staff", "appointment", "service"
  source_id   text NOT NULL,
  entity_id   integer NOT NULL,
  PRIMARY KEY (source, entity, source_id)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     integer REFERENCES users(id),
  action      text NOT NULL,           -- "appointment.create", "patient.update", ...
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  changes     jsonb
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

INSERT INTO sites (id, name) VALUES ('turek', 'Turek'), ('poddebice', 'Poddębice');
