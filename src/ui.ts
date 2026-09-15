import type { SessionUser } from './types';

// Note: XLSX is loaded as a browser global via CDN <script> in the page head;
// it is only referenced inside the client-side <script> string, not here.

const LOGO = 'https://app.coefficient.org/white-coefficient-logo.png';

export function renderApp(user: SessionUser, appEnv: string): string {
  const envBadge = appEnv && appEnv !== 'production'
    ? `<span class="badge">${appEnv}</span>` : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opt-Out Manager</title>
<link rel="icon" type="image/x-icon" href="https://app.coefficient.org/favicon.ico">
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a1628; --card:#0f1f3a; --accent:#E27124; --blue:#245EA4; --navy:#02316B;
  --text:#e2e8f0; --muted:#94a3b8; --subtle:#64748b; --border:#1e2f4d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'DM Sans',system-ui,sans-serif}
h1,h2,h3{font-family:'Inter',sans-serif;margin:0}
a{color:var(--blue)}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border)}
.top img{height:26px}
.top .who{color:var(--muted);font-size:14px}
.top .who a{color:var(--muted);margin-left:14px;text-decoration:none}
.badge{background:var(--accent);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:10px;text-transform:uppercase;letter-spacing:.5px}
.wrap{max-width:960px;margin:32px auto;padding:0 24px}
.tabs{display:flex;gap:8px;margin-bottom:24px}
.tab{background:var(--card);border:1px solid var(--border);color:var(--muted);padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-family:'Inter'}
.tab.active{color:#fff;border-color:var(--accent);background:linear-gradient(180deg,var(--card),#12294a)}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
.card h2{font-size:18px;margin-bottom:6px}
.card p.sub{color:var(--muted);margin:0 0 18px;font-size:14px}
label{display:block;color:var(--muted);font-size:13px;margin:14px 0 6px;font-weight:500}
select,input[type=file]{width:100%;background:#0a1628;border:1px solid var(--border);color:var(--text);padding:11px 12px;border-radius:8px;font-family:inherit;font-size:14px}
.drop{border:2px dashed var(--border);border-radius:10px;padding:26px;text-align:center;color:var(--muted);cursor:pointer;transition:.15s}
.drop.hot{border-color:var(--accent);color:var(--text);background:#0c1d38}
.btn{background:var(--accent);color:#fff;border:none;padding:12px 22px;border-radius:8px;font-weight:600;cursor:pointer;font-family:'Inter';font-size:14px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px}
.stat{background:#0a1628;border:1px solid var(--border);border-radius:10px;padding:16px}
.stat .n{font-family:'Inter';font-size:26px;font-weight:700}
.stat .n.good{color:#4ade80}.stat .n.warn{color:var(--accent)}
.stat .l{color:var(--muted);font-size:12px;margin-top:2px}
.meta{display:flex;gap:20px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin:10px 0 0}
.meta b{color:var(--text)}
.note{background:#1a1206;border:1px solid #5a3a12;color:#f3c99a;padding:12px 14px;border-radius:8px;font-size:13px;margin-top:14px}
.muted{color:var(--muted)} .hide{display:none}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:600}
.btable{table-layout:fixed}
.btable .c-file{width:52%;word-break:break-all}
.btable .c-size{width:11%;text-align:right}
.btable .c-rec{width:13%;text-align:right}
.btable .c-date{width:24%;white-space:nowrap}
.btable th.c-size,.btable th.c-rec{text-align:right}
</style></head>
<body>
<div class="top">
  <img src="${LOGO}" alt="co/efficient">${envBadge}
  <div class="who">${user.email} <a href="/auth/logout">Sign out</a></div>
</div>
<div class="wrap">
  <div class="tabs">
    <div class="tab active" data-tab="scrub">Scrub a list</div>
    <div class="tab" data-tab="push">Upload opt-outs</div>
    <div class="tab" data-tab="browse">Browse buckets</div>
    <div class="tab" data-tab="uploaded">Uploaded lists</div>
    <div class="tab" data-tab="docs">Documentation</div>
  </div>

  <!-- SCRUB -->
  <div id="scrub">
    <div class="card">
      <h2>Scrub a contact list</h2>
      <p class="sub">Remove existing opt-outs from a list before you send. Reads opt-outs for the selected PAC. On download, the cleaned list is also saved to the destination's Google Drive folder. See the Documentation tab for file standards.</p>
      <label>Account (PAC)</label>
      <select id="s-org"><option value="">Loading accounts...</option></select>
      <label>Destination</label>
      <select id="s-dest">
        <option value="">Select a destination...</option>
        <option value="bigdog">Big Dog Strategies</option>
        <option value="creativedirect">Creative Direct</option>
      </select>
      <label>Project name <span class="muted" style="font-weight:400">(used as the Drive file name, e.g. 261187 NH Senate Big Dog SAG MMS 9.16)</span></label>
      <input type="text" id="s-project" placeholder="261187 NH Senate Big Dog SAG MMS 9.16" style="width:100%;background:#0a1628;border:1px solid var(--border);color:var(--text);padding:11px 12px;border-radius:8px;font-family:inherit;font-size:14px">
      <label>Contact list (CSV or Excel)</label>
      <div class="drop" id="s-drop">Drop a CSV or Excel file here or click to choose<input type="file" id="s-file" accept=".csv,.xlsx,.xls" class="hide"></div>
      <div id="s-colwrap" class="hide">
        <label>Phone column <span class="muted" style="font-weight:400">(auto-detected, override if needed)</span></label>
        <select id="s-col"><option value="">Auto-detect</option></select>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn" id="s-run" disabled>Scrub list</button>
        <span id="s-fname" class="muted"></span>
      </div>
    </div>
    <div class="card hide" id="s-result">
      <h2>Results</h2>
      <div class="meta">
        <span>File: <b id="r-file"></b></span>
        <span>PAC: <b id="r-org"></b></span>
        <span>Phone column: <b id="r-col"></b></span>
      </div>
      <div class="stats">
        <div class="stat"><div class="n" id="r-in">0</div><div class="l">Input rows</div></div>
        <div class="stat"><div class="n warn" id="r-scrub">0</div><div class="l">Opt-outs scrubbed</div></div>
        <div class="stat"><div class="n good" id="r-kept">0</div><div class="l">Records kept</div></div>
        <div class="stat"><div class="n" id="r-set">0</div><div class="l">PAC opt-out list size</div></div>
      </div>
      <div class="note hide" id="r-unparse"></div>
      <div class="row" style="margin-top:18px">
        <button class="btn" id="s-dl">Download & save to Drive</button>
        <button class="btn ghost" id="s-reset">Scrub another</button>
      </div>
      <div class="note hide" id="s-drive-msg" style="margin-top:12px"></div>
    </div>
  </div>

  <!-- BROWSE -->
  <div id="browse" class="hide">
    <div class="card">
      <h2>Browse buckets</h2>
      <p class="sub">Read-only view of folders and files in each S3 bucket. No uploads or downloads.</p>
      <label>Bucket</label>
      <select id="b-bucket">
        <option value="p2p">datadash-p2p (source)</option>
        <option value="bigdog">datadash-bigdogstrategies (destination)</option>
        <option value="creativedirect">datadash-creativedirect (destination)</option>
      </select>
      <div class="meta" id="b-summary" style="margin-top:14px"></div>
      <div id="b-tree" style="margin-top:12px"></div>
    </div>
  </div>

  <!-- UPLOADED LISTS (Google Drive) -->
  <div id="uploaded" class="hide">
    <div class="card">
      <h2>Uploaded lists</h2>
      <p class="sub">Scrubbed lists saved to Google Drive, by destination. Read-only.</p>
      <div id="u-tree"><span class="muted">Select this tab to load.</span></div>
    </div>
  </div>

  <!-- DOCS -->
  <div id="docs" class="hide">
    <div class="card">
      <h2>File standards</h2>
      <p class="sub">These conventions apply to opt-out files in all buckets (p2p, Big Dog, Creative Direct). Both flows follow the same standard.</p>
      <h3 style="font-size:15px;margin:18px 0 6px">Filename convention</h3>
      <div class="stat" style="font-family:monospace;font-size:13px">optouts/&lt;org&gt;/optouts_&lt;org&gt;_&lt;YYYYMMDD&gt;_&lt;HHMMSS&gt;.csv</div>
      <div class="meta" style="margin-top:10px">
        <span>Prefix: <b>optouts/</b></span>
        <span>One folder per org (PAC slug)</span>
        <span>Timestamp to the second</span>
      </div>
      <p class="muted" style="font-size:13px;margin-top:8px">Example: <code>optouts/sag-pac/optouts_sag-pac_20260915_125300.csv</code></p>

      <h3 style="font-size:15px;margin:22px 0 6px">Schema</h3>
      <div class="stat" style="font-family:monospace;font-size:13px">organization,phone<br>sag-pac,2012109783</div>
      <div class="meta" style="margin-top:10px">
        <span>Header exactly: <b>organization,phone</b></span>
        <span><b>organization</b> = org slug (lowercase, hyphenated)</span>
        <span><b>phone</b> = raw 10 digits, no formatting</span>
      </div>

      <h3 style="font-size:15px;margin:22px 0 6px">Overwrite policy</h3>
      <ul style="color:var(--muted);font-size:14px;line-height:1.6;margin:6px 0 0;padding-left:20px">
        <li><b style="color:var(--text)">Files are never overwritten.</b> Every push gets a fresh timestamp, so keys are always unique.</li>
        <li>Uploading the same file twice creates two timestamped files. Nothing is clobbered.</li>
        <li>A write guard (HEAD / If-None-Match) will block any accidental overwrite at the API level once writes are enabled.</li>
      </ul>

      <div class="note" style="margin-top:20px">Uploads are local-preview only right now. Nothing is written to any S3 bucket. Writes remain disabled to protect client data.</div>
    </div>
  </div>

  <!-- PUSH -->
  <div id="push" class="hide">
    <div class="card">
      <h2>Upload opt-outs</h2>
      <p class="sub">After a send, upload the new opt-out list for a PAC. Files follow the standard in the Documentation tab: named optouts_&lt;org&gt;_&lt;timestamp&gt;.csv, schema organization,phone, and never overwritten. Writes are currently DISABLED (dry run only) to protect client data.</p>
      <label>Destination</label>
      <select id="p-dest">
        <option value="">Select a destination...</option>
        <option value="bigdog">Big Dog Strategies</option>
        <option value="creativedirect">Creative Direct</option>
      </select>
      <label>Account (PAC)</label>
      <select id="p-org"><option value="">Select a destination first...</option></select>
      <label>Opt-out list (CSV or Excel)</label>
      <div class="drop" id="p-drop">Drop a CSV or Excel file here or click to choose<input type="file" id="p-file" accept=".csv,.xlsx,.xls" class="hide"></div>
      <div class="row hide" id="p-filerow" style="margin-top:6px">
        <span class="muted">File: <b id="p-fname"></b></span>
        <a href="#" id="p-change" style="font-size:13px">Change file</a>
      </div>
      <div class="note" style="margin-top:14px">TEST MODE: uploads are allowed only for the test account <b>testing-nightly-batch</b>. Real client PACs are blocked until testing is verified. Files are never overwritten.</div>
    </div>
    <div class="card hide" id="p-preview-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>Preview</h2>
        <button class="btn" id="p-run" disabled title="Preview must succeed first">Upload opt-outs</button>
      </div>
      <div class="meta" id="p-preview-meta" style="margin-top:10px"></div>
      <div id="p-preview-body" style="margin-top:10px"></div>
    </div>
    <div class="card hide" id="p-result"><h2>Result</h2><div id="p-out" class="muted"></div></div>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
// Convert XLSX/XLS to a CSV File in the browser so only plain text is sent
// (binary Office uploads are blocked by Cloudflare WAF at the edge).
async function toUploadFile(file){
  const nm=(file.name||'').toLowerCase();
  if(!(nm.endsWith('.xlsx')||nm.endsWith('.xls')))return file; // already CSV/text
  if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader not loaded; check your connection and retry.');
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(new Uint8Array(buf),{type:'array'});
  const first=wb.SheetNames[0];
  if(!first)throw new Error('Spreadsheet has no sheets.');
  const csv=XLSX.utils.sheet_to_csv(wb.Sheets[first],{blankrows:false});
  if(!csv.trim())throw new Error('Spreadsheet is empty.');
  const csvName=(file.name||'upload').replace(/\\.(xlsx|xls)$/i,'')+'.csv';
  return new File([csv],csvName,{type:'text/csv'});
}
// Fetch JSON; if the session expired the server redirects to an HTML login
// page -> detect that and send the user to log in instead of choking on HTML.
async function jsonFetch(url,opts){
  const r=await fetch(url,opts);
  const ct=r.headers.get('content-type')||'';
  if(ct.includes('application/json'))return r.json();
  // Non-JSON: only treat as expired session if we were redirected to login.
  if(r.redirected && r.url.indexOf('/auth/login')>=0){
    window.location.href='/auth/login';
    throw new Error('Your session expired. Redirecting to sign in...');
  }
  const txt=await r.text();
  throw new Error('Unexpected response ('+r.status+'): '+txt.slice(0,200));
}
let accounts=[];
async function loadAccounts(){
  let d;
  try{d=await jsonFetch('/api/accounts');}catch(e){return;}
  accounts=d.accounts||[];
  const opts='<option value="">Select a PAC...</option>'+accounts.map(a=>
    '<option value="'+a.org+'">'+a.org+' ('+a.fileCount+' files)</option>').join('');
  $('#s-org').innerHTML=opts;
}
// Upload PAC list is scoped to the chosen destination bucket.
async function loadDestAccounts(dest){
  const sel=$('#p-org');
  if(!dest){sel.innerHTML='<option value="">Select a destination first...</option>';return;}
  sel.innerHTML='<option value="">Loading accounts...</option>';
  try{
    const r=await fetch('/api/accounts/dest/'+dest);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    const accts=d.accounts||[];
    sel.innerHTML='<option value="">Select a PAC...</option>'+accts.map(a=>
      '<option value="'+a.org+'">'+a.org+'</option>').join('');
  }catch(e){
    sel.innerHTML='<option value="">Failed to load ('+e.message+')</option>';
  }
}
$('#p-dest').addEventListener('change',()=>loadDestAccounts($('#p-dest').value));
// tabs
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  $('#scrub').classList.toggle('hide',t.dataset.tab!=='scrub');
  $('#push').classList.toggle('hide',t.dataset.tab!=='push');
  $('#docs').classList.toggle('hide',t.dataset.tab!=='docs');
  $('#browse').classList.toggle('hide',t.dataset.tab!=='browse');
  $('#uploaded').classList.toggle('hide',t.dataset.tab!=='uploaded');
  if(t.dataset.tab==='browse')loadBrowse();
  if(t.dataset.tab==='uploaded')loadUploaded();
});
// drag/drop wiring
function wireDrop(dropId,fileId,fnameId,btnId,orgId,destId){
  const drop=$(dropId),file=$(fileId);
  drop.onclick=()=>file.click();
  ['dragover','dragenter'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('hot')}));
  ['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('hot')}));
  drop.addEventListener('drop',ev=>{if(ev.dataTransfer.files[0]){file.files=ev.dataTransfer.files;onpick()}});
  file.onchange=onpick;
  function onpick(){
    const f=file.files[0];
    var fn=$(fnameId);if(fn)fn.textContent=f?f.name:'';
    const destOk=!destId || !!$(destId).value;
    const ready=!!f && !!$(orgId).value && destOk;
    var b=$(btnId);if(b)b.disabled=!ready;
    if(f&&opts.colwrap)populateCols(f);
    if(opts.onReady)opts.onReady(ready);
  }
  $(orgId).addEventListener('change',onpick);
  if(destId)$(destId).addEventListener('change',onpick);
  const opts={file,colwrap:null,col:null};
  function populateCols(f){
    // Column preview only works for text CSV; skip for Excel (binary).
    const nm=(f.name||'').toLowerCase();
    if(nm.endsWith('.xlsx')||nm.endsWith('.xls')){$(opts.colwrap).classList.add('hide');return;}
    const reader=new FileReader();
    reader.onload=()=>{
      const firstLine=String(reader.result).split(/\\r?\\n/)[0]||'';
      const cols=splitCsvClient(firstLine);
      const auto=guessPhoneCol(cols);
      const sel=$(opts.col);
      sel.innerHTML='<option value="">Auto-detect'+(auto>=0?' ('+cols[auto]+')':'')+'</option>'+
        cols.map((c,i)=>'<option value="'+i+'">'+(c||('col '+i))+'</option>').join('');
      $(opts.colwrap).classList.remove('hide');
    };
    reader.readAsText(f.slice(0,64*1024));
  }
  return opts;
}
// client-side CSV header split + phone guess (mirror of server logic)
function splitCsvClient(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur='';}else cur+=ch;}}out.push(cur);return out;}
function guessPhoneCol(header){const n=header.map(h=>h.trim().toLowerCase());const c=['phone','phone number','phonenumber','cell','mobile','phone_number'];for(const x of c){const i=n.indexOf(x);if(i>=0)return i;}return n.findIndex(h=>h.includes('phone'));}
const s=wireDrop('#s-drop','#s-file','#s-fname','#s-run','#s-org');
s.colwrap='#s-colwrap';s.col='#s-col';
const p=wireDrop('#p-drop','#p-file','#p-fname','#p-run','#p-org','#p-dest');
// Show file row + hide drop zone once a file is chosen; restore on "Change file".
function pFileUI(){
  const f=p.file.files[0];
  if(f){$('#p-drop').classList.add('hide');$('#p-filerow').classList.remove('hide');}
  else{$('#p-drop').classList.remove('hide');$('#p-filerow').classList.add('hide');}
}
$('#p-file').addEventListener('change',pFileUI);
$('#p-change').addEventListener('click',(e)=>{e.preventDefault();$('#p-file').value='';pFileUI();invalidatePreview();});
// Upload requires a successful preview. Any change invalidates it.
let previewOk=false;
function invalidatePreview(){
  previewOk=false;
  $('#p-run').disabled=true;
  $('#p-preview-card').classList.add('hide');
  $('#p-result').classList.add('hide');
}
p.onReady=(ready)=>{ invalidatePreview(); if(ready)autoPreview(); };
$('#p-dest').addEventListener('change',()=>{invalidatePreview();maybeAutoPreview();});
$('#p-org').addEventListener('change',()=>{invalidatePreview();maybeAutoPreview();});
$('#p-file').addEventListener('change',()=>{invalidatePreview();maybeAutoPreview();});
function maybeAutoPreview(){
  const org=$('#p-org').value;const dest=$('#p-dest').value;const f=p.file.files[0];
  if(org&&dest&&f)autoPreview();
}
async function autoPreview(){
  const org=$('#p-org').value;const f=p.file.files[0];
  if(!org||!f)return;
  const card=$('#p-preview-card');card.classList.remove('hide');
  $('#p-preview-meta').innerHTML='';
  $('#p-preview-body').innerHTML='<span class="muted"><span class="spin"></span>Building preview...</span>';
  let d;
  try{
    const up=await toUploadFile(f);
    const fd=new FormData();fd.append('org',org);fd.append('file',up);
    d=await jsonFetch('/api/preview',{method:'POST',body:fd});
  }
  catch(e){$('#p-preview-body').innerHTML='<span class="muted">Preview failed: '+e.message+'</span>';$('#p-run').disabled=true;return;}
  if(d.error){$('#p-preview-body').innerHTML='<span class="muted">Preview failed: '+d.error+'</span>';$('#p-run').disabled=true;return;}
  $('#p-preview-meta').innerHTML='<span><b>'+(d.outputFile||'')+'</b></span><span>Rows in: <b>'+d.inputRows.toLocaleString()+'</b></span><span>Valid opt-outs: <b>'+d.validPhones.toLocaleString()+'</b></span><span>Skipped: <b>'+d.skipped.toLocaleString()+'</b></span>';
  let body='<table class="btable"><thead><tr><th>organization</th><th>phone</th></tr></thead><tbody>';
  d.previewRows.slice(1).forEach(function(row){var c=row.split(',');body+='<tr><td>'+(c[0]||'')+'</td><td>'+(c[1]||'')+'</td></tr>';});
  body+='</tbody></table>';
  if(d.totalOutputRows>d.previewRows.length-1)body+='<p class="muted" style="font-size:12px">Showing first '+(d.previewRows.length-1)+' of '+d.totalOutputRows.toLocaleString()+' rows.</p>';
  $('#p-preview-body').innerHTML=body;
  previewOk=true;$('#p-run').disabled=false;
}

// scrub
$('#s-run').onclick=async()=>{
  const btn=$('#s-run');const org=$('#s-org').value;const f=s.file.files[0];
  btn.disabled=true;btn.innerHTML='<span class="spin"></span>Scrubbing...';
  let d;
  try{
    const up=await toUploadFile(f);
    const fd=new FormData();fd.append('org',org);fd.append('file',up);
    const colv=$('#s-col').value;if(colv!=='')fd.append('phoneCol',colv);
    const r=await fetch('/api/scrub',{method:'POST',body:fd});d=await r.json();
  }catch(e){btn.innerHTML='Scrub list';btn.disabled=false;alert('Error: '+e.message);return;}
  btn.innerHTML='Scrub list';btn.disabled=false;
  if(d.error){alert('Error: '+d.error);return;}
  $('#r-file').textContent=d.inputFile;$('#r-org').textContent=d.org;
  $('#r-col').textContent=d.phoneColumn+(d.autoDetected?' (auto)':' (manual)');
  $('#r-in').textContent=d.inputRows.toLocaleString();
  $('#r-scrub').textContent=d.scrubbed.toLocaleString();
  $('#r-kept').textContent=d.kept.toLocaleString();
  $('#r-set').textContent=d.optOutSetSize.toLocaleString();
  const u=$('#r-unparse');
  if(d.unparseablePhones>0){u.classList.remove('hide');u.textContent=d.unparseablePhones.toLocaleString()+' rows had unreadable phone numbers and were kept (not scrubbed). Check the phone column.';}
  else u.classList.add('hide');
  $('#s-result').classList.remove('hide');
  $('#s-result').scrollIntoView({behavior:'smooth'});
};
$('#s-dl').onclick=async()=>{
  const org=$('#s-org').value;const f=s.file.files[0];
  const dest=$('#s-dest').value;const project=$('#s-project').value.trim();
  if(!dest){alert('Pick a destination before downloading (the cleaned list is also saved to that Drive folder).');return;}
  if(!project){alert('Enter a project name (used as the Drive file name).');return;}
  const btn=$('#s-dl');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Saving...';
  const colv=$('#s-col').value;
  // 1) Download the cleaned CSV to the user
  try{
    const up=await toUploadFile(f);
    const fd=new FormData();fd.append('org',org);fd.append('file',up);if(colv!=='')fd.append('phoneCol',colv);
    const b=await (await fetch('/api/scrub?download=1',{method:'POST',body:fd})).blob();
    const a=document.createElement('a');a.href=URL.createObjectURL(b);
    a.download=(project.endsWith('.csv')?project:project+'.csv');a.click();
  }catch(e){btn.disabled=false;btn.innerHTML='Download & save to Drive';alert('Download failed: '+e.message);return;}
  // 2) Save a copy to the destination Drive folder
  try{
    const up2=await toUploadFile(f);
    const fd2=new FormData();fd2.append('org',org);fd2.append('dest',dest);fd2.append('project',project);fd2.append('file',up2);if(colv!=='')fd2.append('phoneCol',colv);
    const dr=await jsonFetch('/api/scrub/drive',{method:'POST',body:fd2});
    if(dr.error){$('#s-drive-msg').innerHTML='<span class="muted">Saved locally, but Drive save failed: '+dr.error+'</span>';}
    else{$('#s-drive-msg').innerHTML='Saved to <b>'+dr.destinationLabel+'</b> Drive folder as <b>'+dr.driveFileName+'</b>.';}
    $('#s-drive-msg').classList.remove('hide');
  }catch(e){$('#s-drive-msg').classList.remove('hide');$('#s-drive-msg').innerHTML='<span class="muted">Saved locally, but Drive save failed: '+e.message+'</span>';}
  btn.disabled=false;btn.innerHTML='Download & save to Drive';
};
$('#s-reset').onclick=()=>{$('#s-result').classList.add('hide');s.file.value='';$('#s-fname').textContent='';$('#s-run').disabled=true;$('#s-colwrap').classList.add('hide');};

// push (requires successful preview first)
$('#p-run').onclick=async()=>{
  if(!previewOk){$('#p-out').innerHTML='<b>Please preview the file first.</b>';$('#p-result').classList.remove('hide');return;}
  const org=$('#p-org').value;const dest=$('#p-dest').value;const f=p.file.files[0];
  const btn=$('#p-run');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Uploading...';
  let d;
  try{
    const up=await toUploadFile(f);
    const fd=new FormData();fd.append('org',org);fd.append('dest',dest);fd.append('file',up);
    d=await jsonFetch('/api/push',{method:'POST',body:fd});
  }
  catch(e){btn.innerHTML='Upload opt-outs';btn.disabled=false;$('#p-out').innerHTML='<b>'+e.message+'</b>';$('#p-result').classList.remove('hide');return;}
  btn.innerHTML='Upload opt-outs';btn.disabled=false;
  let html='<b>'+(d.message||d.error||'')+'</b>';
  if(d.wrote){html+='<br>Key: <code>'+d.key+'</code><br>Rows in file: '+d.inputRows+', valid opt-outs written: '+d.validPhones+(d.skipped?(', skipped: '+d.skipped):'');}
  else if(d.error){html+='<br><span class="muted">'+(d.detail||d.error)+'</span>';}
  $('#p-out').innerHTML=html;
  $('#p-result').classList.remove('hide');
};
// browse buckets (read-only)
function fmtBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';}
function fmtDate(s){if(!s)return '';var d=new Date(s);if(isNaN(d))return s;return d.toLocaleString('en-US',{timeZone:'America/Chicago',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})+' CT';}
async function loadBrowse(){
  const bucket=$('#b-bucket').value;
  const tree=$('#b-tree');const sum=$('#b-summary');
  tree.innerHTML='<span class="muted"><span class="spin"></span>Loading...</span>';sum.innerHTML='';
  try{
    const r=await fetch('/api/browse/'+bucket);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    if(d.error)throw new Error(d.error);
    sum.innerHTML='<span>Bucket: <b>'+d.bucket+'</b></span><span>Folders: <b>'+d.folderCount+'</b></span><span>Files: <b>'+d.fileCount+'</b></span>';
    const orgs=Object.keys(d.folders).sort();
    if(orgs.length===0){tree.innerHTML='<p class="muted">Empty bucket.</p>';return;}
    let html='';
    for(const org of orgs){
      const files=d.folders[org];
      html+='<div style="margin:14px 0 4px;font-family:Inter;font-weight:600">'+org+' <span class="muted" style="font-weight:400;font-size:12px">('+files.length+')</span></div>';
      html+='<table class="btable"><thead><tr><th class="c-file">File</th><th class="c-size">Size</th><th class="c-rec">Records</th><th class="c-date">Uploaded</th></tr></thead><tbody>';
      for(const f of files){
        var cid='rc_'+bucket+'_'+org+'_'+f.file.replace(/[^a-z0-9]/gi,'_');
        html+='<tr><td class="c-file">'+f.file+'</td><td class="c-size">'+fmtBytes(f.size)+'</td><td class="c-rec muted" id="'+cid+'" data-org="'+org+'" data-file="'+encodeURIComponent(f.file)+'">...</td><td class="c-date muted">'+fmtDate(f.lastModified)+'</td></tr>';
      }
      html+='</tbody></table>';
    }
    tree.innerHTML=html;
    // lazily fetch exact record counts per file
    tree.querySelectorAll('.c-rec[id]').forEach(async cell=>{
      const org=cell.dataset.org;const file=cell.dataset.file;
      try{
        const rr=await fetch('/api/count/'+bucket+'/'+encodeURIComponent(org)+'/'+file);
        const dd=await rr.json();
        if(dd.tooLarge)cell.textContent='large file';
        else if(typeof dd.records==='number'){cell.textContent=dd.records.toLocaleString();cell.classList.remove('muted');}
        else cell.textContent='-';
      }catch(e){cell.textContent='-';}
    });
  }catch(e){
    tree.innerHTML='<p class="muted">Failed to load: '+e.message+'</p>';
  }
}
$('#b-bucket').addEventListener('change',loadBrowse);
// uploaded lists (Google Drive, read-only)
async function loadUploaded(){
  const tree=$('#u-tree');
  tree.innerHTML='<span class="muted"><span class="spin"></span>Loading from Google Drive...</span>';
  try{
    const d=await jsonFetch('/api/drive/list');
    if(d.error)throw new Error(d.error);
    const folders=d.folders||{};
    let html='';
    for(const name of Object.keys(folders)){
      const files=folders[name];
      html+='<div style="margin:14px 0 4px;font-family:Inter;font-weight:600">'+name+' <span class="muted" style="font-weight:400;font-size:12px">('+files.length+')</span></div>';
      if(files.length===0){html+='<p class="muted" style="font-size:13px">No files.</p>';continue;}
      html+='<table class="btable"><thead><tr><th class="c-file">File</th><th class="c-size">Size</th><th class="c-date">Modified</th></tr></thead><tbody>';
      for(const f of files){
        html+='<tr><td class="c-file">'+f.name+'</td><td class="c-size">'+(f.size!=null?fmtBytes(f.size):'-')+'</td><td class="c-date muted">'+fmtDate(f.modifiedTime)+'</td></tr>';
      }
      html+='</tbody></table>';
    }
    tree.innerHTML=html||'<p class="muted">No files.</p>';
  }catch(e){
    tree.innerHTML='<p class="muted">Failed to load: '+e.message+'</p>';
  }
}
loadAccounts();
</script>
</body></html>`;
}
