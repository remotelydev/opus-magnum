-- Settings: staff details, opening hours per site, and each person's weekly work pattern.

-- What the desk and the bot show next to a name, and how to reach the person.
ALTER TABLE staff
  ADD COLUMN title  text,               -- e.g. "lekarz dentysta", "higienistka"
  ADD COLUMN phone  text,
  ADD COLUMN email  text;

-- Regular opening hours: one row per site and weekday (ISO: 1 = Monday ... 7 = Sunday).
-- A weekday with no row is a closed day. Times are clinic-local (Europe/Warsaw).
CREATE TABLE opening_hours (
  site_id   text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens     time NOT NULL,
  closes    time NOT NULL,
  PRIMARY KEY (site_id, weekday),
  CHECK (closes > opens)
);

-- Days that differ from the week: holidays (closed) or shorter or longer hours.
CREATE TABLE opening_exceptions (
  site_id   text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day       date NOT NULL,
  opens     time,                       -- both null = closed all day
  closes    time,
  note      text,                       -- e.g. "Wigilia", "Boże Narodzenie"
  PRIMARY KEY (site_id, day),
  CHECK ((opens IS NULL AND closes IS NULL) OR (opens IS NOT NULL AND closes > opens))
);

-- Weekly work pattern a person's schedule is generated from. Several rows per weekday are allowed
-- (e.g. Turek in the morning, Poddębice in the afternoon). Generating writes rows to `schedules`.
CREATE TABLE work_patterns (
  id        serial PRIMARY KEY,
  staff_id  integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  site_id   text NOT NULL REFERENCES sites(id),
  starts    time NOT NULL,
  ends      time NOT NULL,
  CHECK (ends > starts)
);
CREATE INDEX work_patterns_staff_idx ON work_patterns (staff_id, weekday);
