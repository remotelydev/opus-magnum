-- Each calendar column has its own colour, as in Versum: the dot next to the name in the calendar's
-- staff picker and the stripe over the column. Admins change it in Settings → Staff.
ALTER TABLE staff ADD COLUMN color text CHECK (color ~ '^#[0-9a-f]{6}$');

-- Existing people get the palette in column order, so neighbours never share a colour.
UPDATE staff s
   SET color = (ARRAY['#5b9bd5','#5fc4ad','#3a9ea5','#b18cd9','#7f95e0','#5fb88a',
                      '#e89ab5','#c08a3e','#e57373','#e3b341','#8bc34a','#9c6b8e'])[((r.n - 1) % 12) + 1]
  FROM (SELECT id, row_number() OVER (ORDER BY sort_order, id) AS n FROM staff) r
 WHERE s.id = r.id;
