/**
 * The dashboard, as a string.
 *
 * No build step, no framework, no bundler — one file served by Hono. On demo day
 * the failure mode of a Next.js app is "it didn't compile"; the failure mode of
 * this is nothing, because there is nothing to compile.
 *
 * What it has to show, in order of importance:
 *   1. the kill switch, and its live onchain state
 *   2. the stage the loop is currently in
 *   3. the onchain ruling hash, big enough to read from a projector
 */

export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>perceptual-commerce</title>
<style>
  :root {
    --bg:#0a0b0d; --panel:#141619; --line:#23262b; --text:#e8eaed; --dim:#868b94;
    --ok:#3ddc84; --deny:#ff5c5c; --chain:#8b7cf6; --warn:#ffb020;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
    padding:24px; max-width:1100px; margin-inline:auto;
  }
  h1 { font-size:19px; margin:0 0 2px; letter-spacing:-.2px; }
  .sub { color:var(--dim); font-size:13px; margin-bottom:22px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:820px) { .grid { grid-template-columns:1fr; } }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
  .panel h2 { font-size:11px; text-transform:uppercase; letter-spacing:.9px; color:var(--dim); margin:0 0 12px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:5px 0; font-size:13px; }
  .row span:first-child { color:var(--dim); }
  .row span:last-child { text-align:right; word-break:break-all; }
  button {
    font:inherit; font-size:14px; border:1px solid var(--line); background:#1c1f24; color:var(--text);
    padding:11px 16px; border-radius:8px; cursor:pointer; width:100%; margin-top:8px;
  }
  button:hover { background:#22262c; }
  button.primary { background:#1b3a2a; border-color:#2c5f43; color:var(--ok); }
  button.danger  { background:#3a1c1c; border-color:#5f2c2c; color:var(--deny); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  #log { margin-top:16px; max-height:340px; overflow-y:auto; }
  .ev { display:flex; gap:10px; padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .ev:last-child { border-bottom:0; }
  .ev .t { color:var(--dim); flex:0 0 62px; font-size:12px; }
  .ev .s { flex:0 0 108px; font-weight:600; }
  .ev .d { color:var(--dim); word-break:break-all; }
  .authorized .s { color:var(--chain); }
  .settled .s { color:var(--ok); }
  .rejected .s { color:var(--deny); }
  .filtered .s { color:var(--dim); }
  .pill { display:inline-block; padding:2px 9px; border-radius:99px; font-size:11px; font-weight:600; }
  .pill.on  { background:#3a1c1c; color:var(--deny); }
  .pill.off { background:#1b3a2a; color:var(--ok); }
  .hash { color:var(--chain); font-size:12px; }
  a { color:var(--chain); }
</style>
</head>
<body>
  <h1>perceptual-commerce</h1>
  <div class="sub">perception &rarr; onchain policy &rarr; bounded settlement</div>

  <div class="grid">
    <div class="panel">
      <h2>Policy gate — Monad</h2>
      <div id="policy"><div class="row"><span>loading…</span><span></span></div></div>
      <button class="primary" id="trigger">Shelf is empty &mdash; trigger</button>
      <button class="danger" id="kill">Flip kill switch</button>
    </div>

    <div class="panel">
      <h2>Last result</h2>
      <div id="result"><div class="row"><span>nothing yet</span><span></span></div></div>
    </div>
  </div>

  <div class="panel" id="logPanel" style="margin-top:16px">
    <h2>Live pipeline</h2>
    <div id="log"></div>
  </div>

<script>
const $ = (id) => document.getElementById(id);
const row = (k, v, cls) => \`<div class="row"><span>\${k}</span><span class="\${cls||''}">\${v}</span></div>\`;
let killActive = false;

async function refresh() {
  try {
    const s = await (await fetch('/status')).json();
    const p = s.policy;
    if (p.error) {
      $('policy').innerHTML = row('chain', 'UNREACHABLE — every intent denies', 'hash');
    } else {
      killActive = p.killSwitch;
      $('policy').innerHTML =
        row('kill switch', '<span class="pill ' + (p.killSwitch?'on':'off') + '">' + (p.killSwitch?'ACTIVE — all denied':'off') + '</span>') +
        row('contract', p.address.slice(0,10) + '…' + p.address.slice(-6)) +
        row('cap', (p.maxAmountCents/100).toFixed(2) + ' USD') +
        row('window used', p.windowMints + ' mints, ' + (p.windowCents/100).toFixed(2) + ' USD') +
        row('would allow now', p.wouldAllow ? 'ALLOW' : 'DENY — ' + p.reason, p.wouldAllow ? '' : 'hash');
      $('kill').textContent = p.killSwitch ? 'Turn kill switch OFF' : 'Flip kill switch';
    }
    if (s.lastResult) {
      $('result').innerHTML = s.lastResult.ok
        ? row('outcome','SETTLED') +
          row('card','•••• ' + (s.lastResult.receipt.last4 ?? '—')) +
          row('transaction', s.lastResult.receipt.transactionId ?? '—') +
          row('onchain ruling', s.lastResult.receipt.onchainRef ?? '—', 'hash')
        : row('outcome','REFUSED') + row('reason', s.lastResult.error);
    }
    if (s.cardsMinted !== null) {
      $('result').innerHTML += row('cards minted (fake rail)', s.cardsMinted);
    }
  } catch (e) { /* keep the page up */ }
}

function addEvent(e) {
  if (e.stage === 'ping') return;
  const t = new Date(e.at || Date.now()).toLocaleTimeString('en-GB');
  const detail = e.error || e.detail || (e.receipt ? 'txn ' + e.receipt.transactionId : '') || '';
  const div = document.createElement('div');
  div.className = 'ev ' + e.stage;
  div.innerHTML = '<span class="t">' + t + '</span><span class="s">' + e.stage + '</span><span class="d">' + detail + '</span>';
  $('log').prepend(div);
  if (e.stage === 'settled' || e.stage === 'rejected') refresh();
}

new EventSource('/events').onmessage = (m) => { try { addEvent(JSON.parse(m.data)); } catch {} };

$('trigger').onclick = async () => {
  $('trigger').disabled = true;
  try { await fetch('/trigger', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' }); }
  finally { $('trigger').disabled = false; refresh(); }
};

$('kill').onclick = async () => {
  $('kill').disabled = true;
  $('kill').textContent = 'writing to chain…';
  try {
    await fetch('/kill-switch', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ active: !killActive }) });
  } finally { $('kill').disabled = false; refresh(); }
};

refresh();
setInterval(refresh, 8000);
</script>
</body>
</html>`;
