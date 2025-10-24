import 'dotenv/config';
import { connect as stanConnect } from 'node-nats-streaming';
import fs from 'fs';
const STAN_CLUSTER_ID = process.env.STAN_CLUSTER_ID || 'test-cluster';
const STAN_CLIENT_ID = process.env.STAN_CLIENT_ID || 'orders-pub-node';
const STAN_NATS_URL = process.env.STAN_NATS_URL || 'nats://127.0.0.1:4223';
const STAN_CHANNEL = process.env.STAN_CHANNEL || 'orders';

const tpl = JSON.parse(fs.readFileSync(new URL('../model.json', import.meta.url)));

const sc = stanConnect(STAN_CLUSTER_ID, STAN_CLIENT_ID, { url: STAN_NATS_URL });
sc.on('connect', () => {
  console.log('publisher connected');
  for (let i = 1; i <= 5; i++) {
    const msg = { ...tpl };
    msg.order_uid = `order-${String(i).padStart(4, '0')}`;
    msg.date_created = new Date().toISOString();
    msg.payment = { ...tpl.payment, amount: 100 + Math.floor(Math.random()*1000) };
    sc.publish(STAN_CHANNEL, Buffer.from(JSON.stringify(msg)), (err, guid) => {
      if (err) console.error('publish err', err); else console.log('published', msg.order_uid);
      if (i === 5) sc.close();
    });
  }
});
