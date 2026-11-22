-- Was 004 before main took 004_intake; IF NOT EXISTS so databases that ran the old name stay fine.
-- The doctor's description of the treatment done at a visit ("opis leczenia"), as in Versum. Separate
-- from `notes`, which is reception's organisational note. Doctors and admins write it; it shows in the
-- patient card and in the visit panel of later visits. A first, simple step: the planned clinical
-- record (immutable, encrypted entries) may replace it later.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS treatment_notes text;
