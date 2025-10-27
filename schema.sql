-- Run this in your PostgreSQL before starting the service
CREATE DATABASE order_demo;
\c order_demo;

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional index for searching by fields inside JSON
-- CREATE INDEX IF NOT EXISTS idx_orders_payload_gin ON orders USING GIN (payload);
