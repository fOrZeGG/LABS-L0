const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const pages = {
  search: $('#page-search'),
  order: $('#page-order'),
  about: $('#page-about'),
  list: null // отрисуем динамически в превью
};

const state = {
  cache: new Map(), // id -> payload
  lastList: []
};

function show(page) {
  $$('.page').forEach(p => p.classList.remove('visible'));
  pages[page]?.classList.add('visible');
  $$('.tab').forEach(t => t.setAttribute('aria-selected', (t.dataset.route === page) ? 'true' : 'false'));
}

function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2200);
}

/* ------- API ------- */
async function apiGetOrder(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const res = await fetch(`/api/orders/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Заказ не найден');
  const data = await res.json();
  state.cache.set(id, data);
  return data;
}
async function apiList() {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error('Ошибка списка');
  const data = await res.json();
  state.lastList = data;
  return data;
}

/* ------- Render ------- */
function field(k, v) {
  return `<div class="field"><span class="k">${k}</span><strong>${(v ?? '-') + ''}</strong></div>`;
}
function toMoney(n, cur='USD') {
  const num = Number(n||0);
  try { return new Intl.NumberFormat('en-US', {style:'currency', currency:cur}).format(num); }
  catch { return `${num.toFixed(2)} ${cur}`; }
}

function renderOrder(order) {
  // шапка
  $('#ord-title').textContent = `Order · ${order.order_uid ?? '—'}`;
  $('#ord-track').textContent = order.track_number || '—';
  $('#ord-entry').textContent = order.entry || '—';
  $('#ord-date').textContent  = order.date_created || '—';
  $('#ord-amount').textContent = toMoney(order.payment?.amount, order.payment?.currency || 'USD');
  $('#ord-state').textContent  = (order.items?.[0]?.status ? String(order.items[0].status) : 'PENDING');

  // блоки
  $('#block-overview').innerHTML =
    field('Locale', order.locale) +
    field('Customer ID', order.customer_id) +
    field('Delivery Service', order.delivery_service) +
    field('Internal Signature', order.internal_signature || 'N/A');

  const d = order.delivery || {};
  $('#block-delivery').innerHTML =
    field('Имя', d.name) +
    field('Телефон', d.phone) +
    field('Email', d.email) +
    field('Адрес', d.address) +
    field('Город', d.city) +
    field('ZIP', d.zip) +
    field('Регион', d.region);

  const p = order.payment || {};
  $('#block-payment').innerHTML =
    field('Transaction ID', p.transaction) +
    field('Provider', p.provider) +
    field('Bank', p.bank) +
    field('Amount', toMoney(p.amount, p.currency || 'USD')) +
    field('Delivery Cost', toMoney(p.delivery_cost, p.currency || 'USD')) +
    field('Goods Total', toMoney(p.goods_total, p.currency || 'USD')) +
    field('Custom Fee', toMoney(p.custom_fee, p.currency || 'USD'));

  const wrap = $('#items-wrap');
  wrap.innerHTML = '';
  (order.items || []).forEach((it, idx) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <strong>${idx+1}. ${it.name || 'Item'}</strong>
      <div class="row">
        <div>${field('Brand', it.brand || '-')}</div>
        <div>${field('Price', toMoney(it.price, p.currency || 'USD'))}</div>
        <div>${field('Qty', it.sale || 1)}</div>
        <div>${field('Total', toMoney(it.total_price, p.currency || 'USD'))}</div>
        <div>${field('Status', it.status ?? '—')}</div>
      </div>`;
    wrap.appendChild(el);
  });
}

function renderList(list) {
  const box = $('#list-preview');
  const ul = $('#orders-ul');
  ul.innerHTML = '';
  list.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML =
      `<span>${r.id}</span><span class="muted">${new Date(r.created_at).toLocaleString()}</span>`;
    li.addEventListener('click', () => navigateToOrder(r.id));
    ul.appendChild(li);
  });
  $('#list-count').textContent = `Всего: ${list.length}`;
  box.hidden = list.length === 0;
}

/* ------- Router ------- */
function navigateToOrder(id) {
  location.hash = `#/order/${encodeURIComponent(id)}`;
}

function handleHash() {
  const hash = location.hash || '#/search';
  const [_, route, arg] = hash.split('/');
  // tabs aria
  $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.route === route));
  if (route === 'search') {
    show('search');
  } else if (route === 'order' && arg) {
    show('order');
    apiGetOrder(decodeURIComponent(arg))
      .then(renderOrder)
      .catch(e => { toast(e.message, 'err'); location.hash = '#/search'; });
  } else if (route === 'list') {
    show('search'); // список встроен на первой вкладке
    apiList().then(renderList).catch(() => toast('Не удалось загрузить список'));
  } else if (route === 'about') {
    show('about');
  } else {
    location.hash = '#/search';
  }
}
window.addEventListener('hashchange', handleHash);

/* ------- UI events ------- */
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#search-input').value.trim();
  if (!id) return toast('Введите order_uid');
  // проверим что существует (чтобы не прыгать на пустую страницу)
  try {
    const ord = await apiGetOrder(id);
    renderList([]); // скрыть список
    navigateToOrder(id);
  } catch {
    toast('Заказ не найден');
  }
});
$('#clear-btn').addEventListener('click', () => { $('#search-input').value = ''; });
$('#view-all').addEventListener('click', async () => {
  location.hash = '#/list';
  const data = await apiList().catch(() => []);
  renderList(data);
});
$('#random-one').addEventListener('click', async () => {
  const data = state.lastList.length ? state.lastList : await apiList().catch(() => []);
  if (!data.length) return toast('Сначала загрузите список');
  const pick = data[Math.floor(Math.random() * data.length)];
  navigateToOrder(pick.id);
});
$$('.chip[data-example]').forEach(b => b.addEventListener('click', () => {
  $('#search-input').value = b.dataset.example;
}));

// init
handleHash();
