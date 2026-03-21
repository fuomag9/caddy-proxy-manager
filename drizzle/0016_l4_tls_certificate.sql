ALTER TABLE l4_routes ADD COLUMN certificate_id INTEGER REFERENCES certificates(id) ON DELETE SET NULL;
