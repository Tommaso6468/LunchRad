-- The list every room started with before M5 becomes the default preset
-- "Kantoor". After this, the list is managed in the admin panel.
INSERT INTO restaurant (id, name, name_key, categories, maps_url, created_at, updated_at) VALUES
  ('5eed000000000001', 'Dikke Mik',       'dikke mik',       '["Broodjes"]',             'https://maps.app.goo.gl/Gj5mEfNpXg1wFVHZ9', 0, 0),
  ('5eed000000000002', 'Bibimbap',        'bibimbap',        '["Koreaans","Broodjes"]',  'https://maps.app.goo.gl/ad24L2bzsqnb7e369', 0, 0),
  ('5eed000000000003', 'Zino''s',         'zino''s',         '["Italiaans","Broodjes"]', 'https://maps.app.goo.gl/UyxWz4DRPRZX4rMp7', 0, 0),
  ('5eed000000000004', 'Tokyo Funa Deli', 'tokyo funa deli', '["Japans"]',               'https://maps.app.goo.gl/D9t3Sjd4Tsw4Kb4U8', 0, 0),
  ('5eed000000000005', 'Chang''an DimSum', 'chang''an dimsum', '["Chinees"]',            'https://maps.app.goo.gl/5tSkg36UdTrqt32S6', 0, 0),
  ('5eed000000000006', 'Chang''an',       'chang''an',       '["Chinees"]',              'https://maps.app.goo.gl/51eGciGzfoDwtveM9', 0, 0);

INSERT INTO preset (id, name, name_key, is_default, created_at, updated_at) VALUES
  ('5eed0000000000a1', 'Kantoor', 'kantoor', 1, 0, 0);

INSERT INTO preset_restaurant (preset_id, restaurant_id, position) VALUES
  ('5eed0000000000a1', '5eed000000000001', 0),
  ('5eed0000000000a1', '5eed000000000002', 1),
  ('5eed0000000000a1', '5eed000000000003', 2),
  ('5eed0000000000a1', '5eed000000000004', 3),
  ('5eed0000000000a1', '5eed000000000005', 4),
  ('5eed0000000000a1', '5eed000000000006', 5);
