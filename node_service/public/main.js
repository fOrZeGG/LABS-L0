let limit=10, offset=0, q='', sort='date_created', dir='desc';
const $ = s=>document.querySelector(s);
const list = $('#list'), pageEl=$('#page'), dlg=$('#dlg'), card=$('#card');

async function load(){
  const url = `/orders?limit=${limit}&offset=${offset}&q=${encodeURIComponent(q)}&sort=${sort}&dir=${dir}`;
  const res = await fetch(url);
  const data = await res.json();
  render(data.items||[]);
  pageEl.textContent = (offset/limit)+1;
  $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  $('#total').textContent = 'Showing ' + (data.items?data.items.length:0) + ' orders';
}

function render(items){
  list.innerHTML='';
  items.forEach(it=>{
    const div=document.createElement('div'); div.className='card';
    div.innerHTML = `
      <h3>${it.order_uid}</h3>
      <div class="row">
        <span>Customer: <b>${it.customer||''}</b></span>
        <span>Email: <b>${it.email||''}</b></span>
        <span>City: <b>${it.city||''}</b></span>
        <span>Amount: <b>$${it.total??''}</b></span>
        <span>Date: <b>${it.date_created||''}</b></span>
        <span class="badge link" data-id="${it.order_uid}">Open</span>
      </div>`;
    list.appendChild(div);
  });
}

async function openOrder(id){
  const res = await fetch('/order/'+id);
  if(!res.ok){ alert('Not found'); return; }
  const o = await res.json();
  card.innerHTML = `
    <article>
      <header style="padding:12px 16px;border-bottom:1px solid #eee;background:#f8fafc">
        <h2>Order #${o.order_uid}</h2>
      </header>
      <section style="padding:16px;display:grid;gap:14px">
        <div class="grid">
          <div class="kv"><h4>Track</h4><div>${o.track_number||''}</div></div>
          <div class="kv"><h4>Entry</h4><div>${o.entry||''}</div></div>
          <div class="kv"><h4>Locale</h4><div>${o.locale||''}</div></div>
          <div class="kv"><h4>Date</h4><div>${o.date_created||''}</div></div>
        </div>
        <div class="grid">
          <div class="kv"><h4>Customer</h4><div>${o.customer_id||''}</div></div>
          <div class="kv"><h4>Recipient</h4><div>${o.delivery?.name||''}</div></div>
          <div class="kv"><h4>Phone</h4><div>${o.delivery?.phone||''}</div></div>
          <div class="kv"><h4>Email</h4><div>${o.delivery?.email||''}</div></div>
          <div class="kv"><h4>Address</h4><div>${o.delivery?.city||''}, ${o.delivery?.address||''}</div></div>
          <div class="kv"><h4>Region/ZIP</h4><div>${o.delivery?.region||''} ${o.delivery?.zip||''}</div></div>
        </div>
        <div class="grid">
          <div class="kv"><h4>Amount</h4><div>$${o.payment?.amount??''}</div></div>
          <div class="kv"><h4>Provider</h4><div>${o.payment?.provider||''}</div></div>
          <div class="kv"><h4>Bank</h4><div>${o.payment?.bank||''}</div></div>
          <div class="kv"><h4>Delivery cost</h4><div>$${o.payment?.delivery_cost??''}</div></div>
        </div>
        <div class="kv">
          <h4>Raw JSON</h4>
          <pre>${JSON.stringify(o,null,2)}</pre>
        </div>
      </section>
    </article>`;
  dlg.showModal();
}

$('#btnSearch').onclick=()=>{ q=$('#q').value.trim(); offset=0; load(); };
$('#btnClear').onclick=()=>{ q=''; $('#q').value=''; offset=0; load(); };
$('#btnAll').onclick=()=>{ q=''; $('#q').value=''; offset=0; load(); };
$('#btnRandom').onclick=async()=>{
  const res = await fetch('/orders?limit=1&offset=0');
  const j = await res.json(); if(j.items&&j.items[0]) openOrder(j.items[0].order_uid);
};

$('#sort').onchange=()=>{ sort=$('#sort').value; offset=0; load(); };
$('#dir').onchange=()=>{ dir=$('#dir').value; offset=0; load(); };
$('#prev').onclick=()=>{ if(offset>=limit){ offset-=limit; load(); } };
$('#next').onclick=()=>{ offset+=limit; load(); };
$('#list').addEventListener('click',e=>{ const t=e.target; if(t.classList.contains('link')) openOrder(t.dataset.id); });

load();
