
import 'dotenv/config';
import express from 'express';
import { connect as stanConnect } from 'node-nats-streaming';
import pkg from 'pg';
const { Pool } = pkg;

const PG_DSN = process.env.PG_DSN || 'postgresql://orders_user:orders_pass@localhost:5432/orders_demo';
const STAN_CLUSTER_ID = process.env.STAN_CLUSTER_ID || 'test-cluster';
const STAN_CLIENT_ID = process.env.STAN_CLIENT_ID || 'orders-service-node';
const STAN_NATS_URL = process.env.STAN_NATS_URL || 'nats://127.0.0.1:4222';
const STAN_CHANNEL = process.env.STAN_CHANNEL || 'orders';
const PORT = parseInt(process.env.PORT || '8000', 10);

const pool = new Pool({ connectionString: PG_DSN });
const cache = new Map();

function toSummary(order) {
  return {
    order_uid: order.order_uid,
    customer: order.delivery?.name || '',
    email: order.delivery?.email || '',
    city: order.delivery?.city || '',
    total: order.payment?.amount ?? null,
    date_created: order.date_created || ''
  };
}

// Warm cache
(async () => {
  try {
    const { rows } = await pool.query('SELECT order_uid, payload FROM orders ORDER BY created_at DESC LIMIT 1000');
    rows.forEach(r => cache.set(r.order_uid, r.payload));
    console.log('Cache warmed:', cache.size);
  } catch (e) {
    console.error('DB preload error:', e);
  }
})();

// STAN subscribe
const sc = stanConnect(STAN_CLUSTER_ID, STAN_CLIENT_ID, { url: STAN_NATS_URL });
sc.on('connect', () => {
  console.log('STAN connected');
  const opts = sc.subscriptionOptions();
  opts.setDeliverAllAvailable();
  opts.setDurableName('orders-durable');
  const sub = sc.subscribe(STAN_CHANNEL, opts);
  sub.on('message', async msg => {
    try {
      const data = JSON.parse(msg.getData());
      const id = data.order_uid;
      if (!id) return;
      await pool.query(
        `INSERT INTO orders (order_uid, payload) VALUES ($1, $2)
         ON CONFLICT (order_uid) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
        [id, data]
      );
      cache.set(id, data);
    } catch (e) {
      console.error('message err', e);
    }
  });
});
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));


// Health
app.get('/healthz', (req, res) => res.json({ status: 'ok', cache: cache.size }));

// List orders with search, sort, pagination
app.get('/orders', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const q = (req.query.q || '').toString().trim();
  const sort = (req.query.sort || 'date_created').toString();
  const dir = ((req.query.dir || 'desc').toString().toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

  const where = q ?
    "WHERE (payload->>'order_uid') ILIKE $1 OR (payload->'delivery'->>'name') ILIKE $1 OR (payload->'delivery'->>'email') ILIKE $1" :
    "";
  const sortSql = sort === 'total' ? "(payload->'payment'->>'amount')::int"
               : sort === 'customer' ? "(payload->'delivery'->>'name')"
               : "(payload->>'date_created')";

  const params = [];
  let sql = `SELECT payload FROM orders ${where} ORDER BY ${sortSql} ${dir} LIMIT $${q?2:1} OFFSET $${q?3:2}`;
  if (q) { params.push(`%${q}%`); }
  params.push(limit, offset);

  try {
    const { rows } = await pool.query(sql, params);
    res.json({
      items: rows.map(r => toSummary(r.payload)),
      limit, offset
    });
  } catch (e) {
    console.error('list error', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Single order
app.get('/order/:id', async (req, res) => {
  const id = req.params.id;
  if (cache.has(id)) return res.json(cache.get(id));
  try {
    const { rows } = await pool.query('SELECT payload FROM orders WHERE order_uid=$1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    cache.set(id, rows[0].payload);
    res.json(rows[0].payload);
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.listen(PORT, () => console.log('HTTP on', PORT));
