import type { SessionUser } from './types';

const LOGO = 'https://app.coefficient.org/white-coefficient-logo.png';

export function renderApp(user: SessionUser, appEnv: string): string {
  const envBadge = appEnv && appEnv !== 'production'
    ? `<span class="badge">${appEnv}</span>` : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opt-Out Manager</title>
<link rel="icon" type="image/x-icon" href="https://app.coefficient.org/favicon.ico">
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
    <div class="tab" data-tab="docs">Documentation</div>
  </div>

  <!-- SCRUB -->
  <div id="scrub">
    <div class="card">
      <h2>Scrub a contact list</h2>
      <p class="sub">Remove existing opt-outs from a list before you send. Reads opt-outs for the selected PAC. Nothing is written to any bucket. See the Documentation tab for file standards.</p>
      <label>Account (PAC)</label>
      <select id="s-org"><option value="">Loading accounts...</option></select>
      <label>Contact list (CSV)</label>
      <div class="drop" id="s-drop">Drop a CSV here or click to choose<input type="file" id="s-file" accept=".csv" class="hide"></div>
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
        <button class="btn" id="s-dl">Download scrubbed CSV</button>
        <button class="btn ghost" id="s-reset">Scrub another</button>
      </div>
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
      <select id="p-org"><option value="">Loading accounts...</option></select>
      <label>Opt-out list (CSV)</label>
      <div class="drop" id="p-drop">Drop a CSV here or click to choose<input type="file" id="p-file" accept=".csv" class="hide"></div>
      <div class="note">Writes to client S3 buckets are turned off. This will validate and preview only, without pushing anything.</div>
      <div class="row" style="margin-top:16px">
        <button class="btn" id="p-run" disabled>Preview push (dry run)</button>
        <span id="p-fname" class="muted"></span>
      </div>
    </div>
    <div class="card hide" id="p-result"><h2>Dry run</h2><div id="p-out" class="muted"></div></div>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
let accounts=[];
async function loadAccounts(){
  const r=await fetch('/api/accounts');const d=await r.json();
  accounts=d.accounts||[];
  const opts='<option value="">Select a PAC...</option>'+accounts.map(a=>
    '<option value="'+a.org+'">'+a.org+' ('+a.fileCount+' files)</option>').join('');
  $('#s-org').innerHTML=opts;$('#p-org').innerHTML=opts;
}
// tabs
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  $('#scrub').classList.toggle('hide',t.dataset.tab!=='scrub');
  $('#push').classList.toggle('hide',t.dataset.tab!=='push');
  $('#docs').classList.toggle('hide',t.dataset.tab!=='docs');
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
    $(fnameId).textContent=f?f.name:'';
    const destOk=!destId || !!$(destId).value;
    const ready=!!f && !!$(orgId).value && destOk;
    $(btnId).disabled=!ready;
    if(f&&opts.colwrap)populateCols(f);
  }
  $(orgId).onchange=onpick;
  if(destId)$(destId).onchange=onpick;
  const opts={file,colwrap:null,col:null};
  function populateCols(f){
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

// scrub
$('#s-run').onclick=async()=>{
  const btn=$('#s-run');const org=$('#s-org').value;const f=s.file.files[0];
  btn.disabled=true;btn.innerHTML='<span class="spin"></span>Scrubbing...';
  const fd=new FormData();fd.append('org',org);fd.append('file',f);
  const colv=$('#s-col').value;if(colv!=='')fd.append('phoneCol',colv);
  const r=await fetch('/api/scrub',{method:'POST',body:fd});const d=await r.json();
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
$('#s-dl').onclick=()=>{
  const org=$('#s-org').value;const f=s.file.files[0];
  const fd=new FormData();fd.append('org',org);fd.append('file',f);
  const colv=$('#s-col').value;if(colv!=='')fd.append('phoneCol',colv);
  fetch('/api/scrub?download=1',{method:'POST',body:fd}).then(r=>r.blob()).then(b=>{
    const a=document.createElement('a');a.href=URL.createObjectURL(b);
    a.download=f.name.replace(/\\.csv$/i,'')+'_scrubbed_'+org+'.csv';a.click();
  });
};
$('#s-reset').onclick=()=>{$('#s-result').classList.add('hide');s.file.value='';$('#s-fname').textContent='';$('#s-run').disabled=true;$('#s-colwrap').classList.add('hide');};

// push (dry run)
$('#p-run').onclick=async()=>{
  const org=$('#p-org').value;const dest=$('#p-dest').value;const f=p.file.files[0];
  const fd=new FormData();fd.append('org',org);fd.append('dest',dest);fd.append('file',f);
  const r=await fetch('/api/push',{method:'POST',body:fd});const d=await r.json();
  $('#p-out').innerHTML='<b>'+(d.message||'')+'</b><br>Would push <b>'+(d.wouldPush?.file||'')+'</b> for PAC <b>'+(d.wouldPush?.org||'')+'</b> to destination: <b>'+(d.wouldPush?.destinationLabel||d.wouldPush?.destination||'')+'</b>';
  $('#p-result').classList.remove('hide');
};
loadAccounts();
</script>
</body></html>`;
}
