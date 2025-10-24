-- Простая модель хранения: одна таблица с JSONB.
CREATE DATABASE orders_demo;

CREATE USER orders_user WITH PASSWORD 'orders_pass';
GRANT ALL PRIVILEGES ON DATABASE orders_demo TO orders_user;

\connect orders_demo;

CREATE TABLE IF NOT EXISTS orders (
  order_uid TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO orders_user;
