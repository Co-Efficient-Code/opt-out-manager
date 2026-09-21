import type { SessionUser } from './types';

// Note: XLSX is loaded as a browser global via CDN <script> in the page head;
// it is only referenced inside the client-side <script> string, not here.

const LOGO = 'https://app.coefficient.org/white-coefficient-logo.png';

export function renderApp(user: SessionUser, _appEnv: string): string {
  const envBadge = '';
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
.tab{flex:1 1 0;min-width:0;text-align:center;background:var(--card);border:1px solid var(--border);color:var(--muted);padding:10px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-family:'Inter';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tab.active{color:#fff;border-color:var(--accent);background:linear-gradient(180deg,var(--card),#12294a)}
.tab.disabled{opacity:.4;cursor:not-allowed;color:var(--subtle)}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
.card h2{font-size:18px;margin-bottom:6px}
.card p.sub{color:var(--muted);margin:0 0 18px;font-size:14px}
label{display:block;color:var(--muted);font-size:13px;margin:14px 0 6px;font-weight:500}
select,input[type=file],input[type=text]{width:100%;background:#0a1628;border:1px solid var(--border);color:var(--text);padding:11px 12px;border-radius:8px;font-family:inherit;font-size:14px;box-sizing:border-box}
.drop{border:2px dashed var(--border);border-radius:10px;padding:26px;text-align:center;color:var(--muted);cursor:pointer;transition:.15s}
.drop.hot{border-color:var(--accent);color:var(--text);background:#0c1d38}
.drop.filled{border-style:solid;border-color:#1f9d55;color:var(--text);background:#0d2a1a;cursor:default}
.drop.filled .s-drop-name{font-weight:600}
.drop.filled .s-drop-change{display:inline-block;margin-top:6px;font-size:12px;color:var(--muted);cursor:pointer;text-decoration:underline}
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
.sstatus{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
.sstatus .ok{color:#4ade80}
.sstatus .bad{color:#f3c99a}
.sstatus b{color:var(--text);font-weight:600}
.srow{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:18px}
.sprogress{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)}
/* 3-up input row (PAC / Destination / Project) */
.frow3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.fcol{min-width:0;display:flex;flex-direction:column}
.fcol label{margin-top:0}
/* 4-up column-mapping row */
.kmap4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#0a1628;border:1px solid var(--border);border-radius:8px;padding:12px}
.kmcol{min-width:0;display:flex;flex-direction:column;gap:5px}
.kmlbl{font-size:12px;color:var(--muted)}
.req{color:var(--accent);font-weight:700}
.kmcol select.bad{border-color:var(--accent)}
@media(max-width:720px){.frow3{grid-template-columns:1fr}.kmap4{grid-template-columns:1fr 1fr}}
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
.ptable{table-layout:fixed;width:100%}
.ptable th,.ptable td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ptable .c-proj{width:44%}
.ptable .c-pac{width:16%}
.ptable .c-dest{width:14%}
.ptable .c-new{width:9%;text-align:right}
.ptable .c-tot{width:9%;text-align:right}
.ptable th.c-new,.ptable th.c-tot{text-align:right}
.ptable .c-stat{width:6%;text-align:center;overflow:visible}
.ptable th.c-stat{text-align:center}
.qtable{table-layout:fixed;width:100%}
.qtable td,.qtable th{vertical-align:bottom}
.qtable .q-proj{width:34%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.qtable .q-held{width:16%;text-align:right;white-space:nowrap;vertical-align:middle}
.qtable th.q-held{text-align:right}
.qtable .q-assign{width:50%}
.assign{display:flex;gap:8px;align-items:flex-end}
.assign .asg-field{flex:1 1 0;min-width:0}
.assign .asg-field label{display:block;color:var(--muted);font-size:12px;margin:0 0 4px;font-weight:500}
.assign .asg-pac,.assign .asg-dest{width:100%}
.assign .asg-save{flex:0 0 auto}
.assign .asg-msg{flex:0 0 auto}
.htable{width:100%}
/* All tables stay within their card: never exceed the container width. */
.card table{max-width:100%}
@media (max-width:640px){
  /* Header: hide the logged-in email, keep Sign out. */
  .who-email{display:none}
  .top{padding:12px 16px}
  .wrap{margin:18px auto;padding:0 12px}
  .card{padding:16px;overflow:hidden}
  /* Tabs: single-row horizontal scroll strip. Each tab keeps its label on one
     line at natural size; swipe left/right through them. */
  .tabs{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:8px;padding-bottom:4px;scrollbar-width:none}
  .tabs::-webkit-scrollbar{display:none}
  .tab{flex:0 0 auto;white-space:nowrap;overflow:visible;text-overflow:clip;font-size:13px;padding:11px 16px}
  /* Tables: horizontal scroll at natural width inside the card, so columns are
     never crushed (the "When" column stays readable on one line). */
  .card>table,.card>div>table,#rl-hist table,#b-tree table,#u-tree table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table th,table td{white-space:nowrap}
  /* Triggered by: wrap at word boundaries (so "(automated)" breaks as a whole
     word, not mid-word), wide enough to fit "(automated)" on one line. */
  .htable .h-by{white-space:normal;overflow-wrap:break-word;word-break:normal;min-width:112px}
  /* When: allow a gentle wrap so it does not hog width. */
  .htable .h-when{white-space:normal;min-width:120px}
  .stats{grid-template-columns:repeat(2,1fr)}
}
/* Monospace convention/example boxes: keep long strings contained (wrap, never
   overflow the card). */
.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
/* When: let the date wrap a little instead of eating width. Triggered by: a bit
   wider so "(automated)" wraps as a whole word, not "automate/d". */
.htable .h-when{width:20%;white-space:normal}
.htable .h-by{width:18%;white-space:normal;overflow-wrap:break-word}
.htable .h-num{text-align:right;width:13%}
.htable th.h-num{text-align:right}
.htable .h-email{width:15%;text-align:center}
.htable th.h-email{text-align:center}
.ic{display:inline-flex;vertical-align:middle}
.ic svg{width:17px;height:17px}
.ic-ok{color:#4ade80}.ic-block{color:#f87171}
.ptable .c-new .nt-new{color:#4ade80;font-weight:600}
.ptable .c-tot{color:var(--muted)}
</style></head>
<body>
<div class="top">
  <img src="${LOGO}" alt="co/efficient">${envBadge}
  <div class="who"><span class="who-email">${user.email}</span> <a href="/auth/logout">Sign out</a></div>
</div>
<div class="wrap">
  <div class="tabs">
    <div class="tab active" data-tab="scrub">Scrub a list</div>
    <div class="tab" data-tab="runlogs">Run logs</div>
    <div class="tab" data-tab="uploaded">Uploaded lists</div>
    <div class="tab" data-tab="browse">Browse buckets</div>
    <div class="tab" data-tab="docs">Documentation</div>
  </div>

  <!-- SCRUB -->
  <div id="scrub">
    <div class="card">
      <h2>Scrub a contact list</h2>
      <div class="frow3">
        <div class="fcol">
          <label>Account (PAC)</label>
          <select id="s-org"><option value="">Loading accounts...</option></select>
        </div>
        <div class="fcol">
          <label>Destination</label>
          <select id="s-dest">
            <option value="">Select a destination...</option>
            <option value="bigdog">Big Dog Strategies</option>
            <option value="creativedirect">Creative Direct</option>
          </select>
        </div>
        <div class="fcol">
          <label>Project name</label>
          <input type="text" id="s-project" placeholder="261187 NH Senate Big Dog SAG MMS 9.16">
        </div>
      </div>
      <label>Contact list (CSV or Excel)</label>
      <div class="drop" id="s-drop"><span id="s-drop-text">Drop a CSV or Excel file here or click to choose</span><input type="file" id="s-file" accept=".csv,.xlsx,.xls" class="hide"></div>
      <div id="s-keepwrap" class="hide">
        <label>Output columns <span class="muted" style="font-weight:400">(map your file's columns; only these are kept in the output)</span></label>
        <div class="kmap4">
          <div class="kmcol"><span class="kmlbl">CellPhone <span class="req">*</span></span><select class="s-map" id="s-map-cellphone" data-field="CellPhone"></select></div>
          <div class="kmcol"><span class="kmlbl">FirstName <span class="req">*</span></span><select class="s-map" id="s-map-firstname" data-field="FirstName"></select></div>
          <div class="kmcol"><span class="kmlbl">LastName <span class="req">*</span></span><select class="s-map" id="s-map-lastname" data-field="LastName"></select></div>
          <div class="kmcol"><span class="kmlbl">SelectName <span class="muted" style="font-weight:400">(optional)</span></span><select class="s-map" id="s-map-selectname" data-field="SelectName"></select></div>
        </div>
        <div class="note hide" id="s-map-warn"></div>
      </div>
      <div class="srow">
        <button class="btn" id="s-run" disabled>Scrub list</button>
        <div class="sprogress hide" id="s-progress"><span class="spin"></span><span id="s-progress-text"></span></div>
        <div class="sstatus hide" id="s-drive-msg"></div>
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
    </div>
  </div>

  <!-- RUN LOGS (dry-run, read-only) -->
  <div id="runlogs" class="hide">
    <div class="card">
      <h2>Opt-out run logs</h2>
      <div class="row">
        <button class="btn" id="rl-run">Refresh Optouts</button>
        <span id="rl-status" class="muted"></span>
      </div>
      <div id="rl-summary" class="hide">
        <div class="meta" id="rl-meta" style="margin-top:16px"></div>
        <div class="stats" id="rl-stats" style="margin-top:12px"></div>
      </div>
    </div>
    <div class="card hide" id="rl-quar-card">
      <h2>Quarantined <span class="muted" style="font-weight:400;font-size:13px">(unmapped, not counted for upload)</span></h2>
      <div id="rl-quar"></div>
    </div>
    <div class="card hide" id="rl-groups-card">
      <h2>New opt-outs</h2>
      <div id="rl-groups"></div>
    </div>
    <div class="card hide" id="rl-proj-card">
      <h2>All projects</h2>
      <div id="rl-proj"></div>
    </div>
    <div class="card" id="rl-hist-card">
      <h2>Run history</h2>
      <div id="rl-hist"><span class="muted">No runs yet. Hit Refresh Optouts.</span></div>
    </div>
  </div>

  <!-- BROWSE -->
  <div id="browse" class="hide">
    <div class="card">
      <h2>Browse buckets</h2>
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
      <div id="u-tree"><span class="muted">Select this tab to load.</span></div>
    </div>
  </div>

  <!-- DOCS -->
  <div id="docs" class="hide">
    <div class="card">
      <h2>File standards</h2>
      <h3 style="font-size:15px;margin:18px 0 6px">Filename convention</h3>
      <div class="stat mono">optouts/&lt;org&gt;/optouts_&lt;org&gt;_&lt;YYYYMMDD&gt;_&lt;HHMMSS&gt;.csv</div>
      <div class="meta" style="margin-top:10px">
        <span>Prefix: <b>optouts/</b></span>
        <span>One folder per org (PAC slug)</span>
        <span>Timestamp to the second</span>
      </div>
      <p class="muted" style="font-size:13px;margin-top:8px">Example: <code>optouts/sag-pac/optouts_sag-pac_20260915_125300.csv</code></p>

      <h3 style="font-size:15px;margin:22px 0 6px">Schema</h3>
      <div class="stat mono">organization,phone<br>sag-pac,2012109783</div>
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

    </div>

    <div class="card">
      <h2>How we read opt-outs from ReadyGOP</h2>
      <p class="sub">ReadyGOP is the texting platform that holds the live opt-outs. We read them through an internal proxy; the app never talks to ReadyGOP directly and never writes to it.</p>
      <h3 style="font-size:15px;margin:18px 0 6px">Endpoint and method</h3>
      <div class="stat mono">POST https://tools.coefficient.org/api/rgop-proxy</div>
      <ul style="color:var(--muted);font-size:14px;line-height:1.6;margin:8px 0 0;padding-left:20px">
        <li><b style="color:var(--text)">Method:</b> HTTP <b style="color:var(--text)">POST</b>, body is a GraphQL query (Content-Type application/json).</li>
        <li><b style="color:var(--text)">Proxy:</b> a pass-through to ReadyGOP's GraphQL API (api.readygop.com/graphql). The proxy injects the auth token, so the key stays server-side.</li>
        <li><b style="color:var(--text)">Query:</b> root <code>optOuts(first, after, filters)</code> with a <code>clientId EQUAL</code> filter, paged by cursor, newest first. (We avoid <code>client(id).optOuts</code> which is unpaginated and times out.)</li>
        <li><b style="color:var(--text)">Each record returns:</b> phone number, project (number + name), opt-out type, and timestamp. The phone number is the key we scrub on.</li>
        <li><b style="color:var(--text)">Read only:</b> we only ever pull. Opt-outs are never written back to ReadyGOP.</li>
      </ul>
    </div>

    <div class="card">
      <h2>How scrubbing works</h2>
      <p class="sub">Scrubbing removes people who already opted out from a contact list, before a send.</p>
      <ol style="color:var(--muted);font-size:14px;line-height:1.7;margin:8px 0 0;padding-left:20px">
        <li>You pick a <b style="color:var(--text)">PAC</b> and drop in a <b style="color:var(--text)">contact list</b> (CSV or Excel).</li>
        <li>We build that PAC's <b style="color:var(--text)">opt-out set</b> by reading its opt-out files from S3 (read-only) and normalizing every phone to 10 digits.</li>
        <li>We walk your list and <b style="color:var(--text)">drop any row whose phone is in the opt-out set</b>. Everyone else is kept.</li>
        <li>You get back a <b style="color:var(--text)">cleaned list</b> plus a count of how many were scrubbed, and a copy is saved to the destination's Drive folder.</li>
      </ol>
      <p class="muted" style="font-size:13px;margin-top:10px">In short: contact list in, opt-outs subtracted, clean list out. The opt-out source is always read-only, so scrubbing can never change client data.</p>
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
// Base64-encode a byte buffer (chunked to avoid call-stack limits on big files).
function bytesToBase64(bytes){
  let bin='';const CH=0x8000;
  for(let i=0;i<bytes.length;i+=CH){bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+CH));}
  return btoa(bin);
}
// Prepare the upload. We base64-encode the CSV and send it as a plain-text
// .csv.b64 file. Base64 output is only [A-Za-z0-9+/=], so it contains none of
// the tokens (like '--' in dirty date fields) that trip the Cloudflare WAF's
// managed SQLi ruleset and cause false-positive 403 blocks at the edge.
// (Gzip was tried but large binary bodies get flagged on their own; base64
// stays plain text and passes.) The server detects the .b64 name / marker and
// decodes before parsing.
async function toUploadFile(file){
  const nm=(file.name||'').toLowerCase();
  let csvName, csvText;
  if(nm.endsWith('.xlsx')||nm.endsWith('.xls')){
    if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader not loaded; check your connection and retry.');
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(new Uint8Array(buf),{type:'array'});
    const first=wb.SheetNames[0];
    if(!first)throw new Error('Spreadsheet has no sheets.');
    const csv=XLSX.utils.sheet_to_csv(wb.Sheets[first],{blankrows:false});
    if(!csv.trim())throw new Error('Spreadsheet is empty.');
    csvName=(file.name||'upload').replace(/\\.(xlsx|xls)$/i,'')+'.csv';
    csvText=new TextEncoder().encode(csv);
  }else{
    csvName=(file.name||'upload');
    csvText=new Uint8Array(await file.arrayBuffer());
  }
  const b64=bytesToBase64(csvText);
  return new File([b64],csvName+'.b64',{type:'text/plain'});
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
  if(t.classList.contains('disabled'))return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  $('#scrub').classList.toggle('hide',t.dataset.tab!=='scrub');
  $('#runlogs').classList.toggle('hide',t.dataset.tab!=='runlogs');
  $('#push').classList.toggle('hide',t.dataset.tab!=='push');
  $('#docs').classList.toggle('hide',t.dataset.tab!=='docs');
  $('#browse').classList.toggle('hide',t.dataset.tab!=='browse');
  $('#uploaded').classList.toggle('hide',t.dataset.tab!=='uploaded');
  if(t.dataset.tab==='browse')loadBrowse();
  if(t.dataset.tab==='uploaded')loadUploaded();
  if(t.dataset.tab==='runlogs')loadRunHistory();
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
    if(opts.afterPick)opts.afterPick();
  }
  $(orgId).addEventListener('change',onpick);
  if(destId)$(destId).addEventListener('change',onpick);
  const opts={file,colwrap:null,col:null,onpick,drop,afterPick:null};
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
const s=wireDrop('#s-drop','#s-file',null,'#s-run','#s-org','#s-dest');
// Phone column is now driven by the CellPhone mapping (no separate dropdown).
// Scrub drop zone: go green + show file name inside the zone once a file is chosen.
// Keeps the <input> element stable (no innerHTML swap) so wireDrop bindings survive.
function sFileUI(){
  const f=s.file.files[0];const drop=$('#s-drop');const txt=$('#s-drop-text');
  if(f){
    drop.classList.add('filled');
    txt.innerHTML='<div class="s-drop-name"></div><div class="s-drop-change">Change file</div>';
    txt.querySelector('.s-drop-name').textContent=f.name;
    txt.querySelector('.s-drop-change').onclick=(e)=>{e.stopPropagation();s.file.value='';s.onpick();sFileUI();};
  }else{
    drop.classList.remove('filled');
    txt.textContent='Drop a CSV or Excel file here or click to choose';
  }
  sBuildKeep();
}
// Output field mapping. Required fields must be mapped; SelectName is optional.
// Auto-detect by matching common header-name aliases.
const S_MAP_ALIASES={
  CellPhone:['cellphone','cell phone','phone','phonenumber','phone number','cell','mobile','phone_number'],
  FirstName:['firstname','first name','first','fname'],
  LastName:['lastname','last name','last','lname'],
  SelectName:['selectname','select name','select']
};
const S_MAP_REQUIRED=['CellPhone','FirstName','LastName'];
// Output order for kept columns:
const S_MAP_ORDER=['SelectName','FirstName','LastName','CellPhone'];
let sHeaderCols=[];
function sMapSelId(field){return '#s-map-'+field.toLowerCase();}
// Read the uploaded file's header (CSV or XLSX) and populate the mapping dropdowns.
async function sBuildKeep(){
  const wrap=$('#s-keepwrap');const f=s.file.files[0];
  if(!f){wrap.classList.add('hide');sHeaderCols=[];return;}
  let cols=[];
  try{
    const nm=(f.name||'').toLowerCase();
    if(nm.endsWith('.xlsx')||nm.endsWith('.xls')){
      if(typeof XLSX==='undefined'){wrap.classList.add('hide');return;}
      const buf=await f.slice(0,256*1024).arrayBuffer();
      const wb=XLSX.read(new Uint8Array(buf),{type:'array',sheetRows:1});
      const sheet=wb.Sheets[wb.SheetNames[0]];
      const csv=XLSX.utils.sheet_to_csv(sheet);
      cols=splitCsvClient((csv.split(/\\r?\\n/)[0])||'');
    }else{
      const txt=await f.slice(0,64*1024).text();
      cols=splitCsvClient((txt.split(/\\r?\\n/)[0])||'');
    }
  }catch(e){wrap.classList.add('hide');return;}
  sHeaderCols=cols;
  const lower=cols.map(c=>String(c).trim().toLowerCase());
  Object.keys(S_MAP_ALIASES).forEach(field=>{
    const sel=$(sMapSelId(field));if(!sel)return;
    const optional=S_MAP_REQUIRED.indexOf(field)<0;
    let auto=-1;
    for(const a of S_MAP_ALIASES[field]){const i=lower.indexOf(a);if(i>=0){auto=i;break;}}
    let html=(optional?'<option value="">(not included)</option>':'<option value="">-- select a column --</option>');
    html+=cols.map((c,i)=>'<option value="'+i+'"'+(i===auto?' selected':'')+'>'+String(c||('col '+i)).replace(/</g,'&lt;')+'</option>').join('');
    sel.innerHTML=html;
    sel.onchange=sMapValidate;
  });
  wrap.classList.remove('hide');
  sMapValidate();
}
// Validate required mappings; disable Scrub + warn if any required field is unmapped.
function sMapValidate(){
  if($('#s-keepwrap').classList.contains('hide'))return true;
  const missing=[];
  S_MAP_REQUIRED.forEach(field=>{
    const sel=$(sMapSelId(field));if(!sel)return;
    const ok=sel.value!=='';
    sel.classList.toggle('bad',!ok);
    if(!ok)missing.push(field);
  });
  const warn=$('#s-map-warn');
  if(missing.length){warn.textContent='Map these required columns before scrubbing: '+missing.join(', ')+'. Auto-detect could not find them in this file.';warn.classList.remove('hide');}
  else warn.classList.add('hide');
  // Reflect in the run button (only when in scrub mode with a file+dest+pac).
  if(sMode==='scrub'){const baseReady=!!s.file.files[0]&&!!$('#s-org').value&&!!$('#s-dest').value;$('#s-run').disabled=baseReady?(missing.length>0):true;}
  return missing.length===0;
}
// Build the keepColumns list (in output order) from the current mapping.
// Returns array of source column NAMES to keep, or null if mapping UI isn't active.
function sKeepColumns(){
  if($('#s-keepwrap').classList.contains('hide'))return null;
  const out=[];
  S_MAP_ORDER.forEach(field=>{
    const sel=$(sMapSelId(field));if(!sel||sel.value==='')return;
    const name=sHeaderCols[parseInt(sel.value,10)];
    if(name&&out.indexOf(name)<0)out.push(name);
  });
  return out.length?out:null;
}
// Filled zone should not re-open the picker on body click (only the Change link handles it).
// wireDrop already handles click-to-open + drag/drop; we only block re-open when filled.
s.afterPick=()=>{sFileUI();sMapValidate();};
const _sDropClick=$('#s-drop').onclick;
$('#s-drop').onclick=(e)=>{if($('#s-drop').classList.contains('filled'))return;if(_sDropClick)_sDropClick.call($('#s-drop'),e);else s.file.click();};
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

// scrub: one click = scrub + download + save to Drive. Button then becomes "Scrub another".
let sMode='scrub'; // 'scrub' | 'again'
function sResetForm(){
  s.file.value='';sFileUI();
  $('#s-org').value='';
  $('#s-dest').value='';
  $('#s-project').value='';
  $('#s-result').classList.add('hide');
  $('#s-keepwrap').classList.add('hide');$('#s-map-warn').classList.add('hide');sHeaderCols=[];
  $('#s-drive-msg').classList.add('hide');$('#s-drive-msg').innerHTML='';
  $('#s-progress').classList.add('hide');$('#s-progress-text').textContent='';
  const btn=$('#s-run');btn.textContent='Scrub list';btn.classList.remove('ghost');btn.disabled=true;
  sMode='scrub';
  s.onpick();
}
// Live single-line progress narration. Hidden when idle; replaced by green checks when done.
function sProg(text){const p=$('#s-progress');$('#s-progress-text').textContent=text;p.classList.remove('hide');}
function sProgDone(){$('#s-progress').classList.add('hide');$('#s-progress-text').textContent='';}
// POST a form and read a streamed NDJSON response, calling onProgress for each
// {progress} line. Returns the final {done,...} object (or throws on {error}).
async function streamScrub(url,body,onProgress){
  const r=await fetch(url,{method:'POST',body});
  const ct=r.headers.get('content-type')||'';
  // Session expired -> server redirected us to an HTML login page.
  if(r.redirected && r.url.indexOf('/auth/login')>=0){window.location.href='/auth/login';throw new Error('Your session expired. Redirecting to sign in...');}
  if(!r.body||ct.indexOf('ndjson')<0){
    // Fallback: not a stream. Try JSON, else surface a readable error.
    let t='';try{t=await r.text();}catch(e){}
    try{const j=JSON.parse(t);if(j.error)throw new Error(j.error);return j;}catch(e){throw new Error('Unexpected response ('+r.status+'): '+t.slice(0,200));}
  }
  const reader=r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf='',final=null;
  for(;;){
    const {value,done}=await reader.read();
    if(done)break;
    buf+=value;let nl=buf.indexOf('\\n');
    while(nl>=0){
      const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);nl=buf.indexOf('\\n');
      if(!line)continue;
      let obj;try{obj=JSON.parse(line);}catch(e){continue;}
      if(obj.progress&&onProgress)onProgress(obj.progress);
      else if(obj.error)throw new Error(obj.error);
      else if(obj.done)final=obj;
    }
  }
  if(buf.trim()){try{const obj=JSON.parse(buf.trim());if(obj.error)throw new Error(obj.error);if(obj.done)final=obj;}catch(e){}}
  if(!final)throw new Error('Scrub did not complete (no result received).');
  return final;
}
$('#s-run').onclick=async()=>{
  const btn=$('#s-run');
  if(sMode==='again'){sResetForm();return;}
  const org=$('#s-org').value;const f=s.file.files[0];
  const dest=$('#s-dest').value;const project=$('#s-project').value.trim();
  if(!dest){alert('Pick a destination first (the cleaned list is saved to that Drive folder).');return;}
  if(!project){alert('Enter a project name (used as the Drive file name).');return;}
  if(!sMapValidate()){alert('Map the required output columns (CellPhone, FirstName, LastName) before scrubbing.');return;}
  // Phone column index comes from the CellPhone mapping.
  const cpsel=$('#s-map-cellphone');
  const colv=(cpsel&&cpsel.value!=='')?cpsel.value:'';
  btn.disabled=true;btn.textContent='Working...';
  $('#s-drive-msg').classList.add('hide');$('#s-drive-msg').innerHTML='';
  // Single upload, streamed NDJSON response drives the live progress line.
  let d;
  try{
    sProg('Reading file...');
    const up=await toUploadFile(f);
    const fd=new FormData();fd.append('org',org);fd.append('dest',dest);fd.append('project',project);fd.append('file',up);if(colv!=='')fd.append('phoneCol',colv);
    const keep=sKeepColumns();if(keep!==null)fd.append('keepColumns',keep.join(','));
    d=await streamScrub('/api/scrub/drive',fd,(msg)=>sProg(msg));
  }catch(e){sProgDone();btn.textContent='Scrub list';btn.disabled=false;alert('Scrub failed: '+e.message);return;}
  if(d.error){sProgDone();btn.textContent='Scrub list';btn.disabled=false;alert('Scrub failed: '+d.error);return;}
  // Render results
  sProg('Rendering results...');
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
  const dlName=d.downloadName||(project.replace(/\.csv$/i,'')+'_scrubbed.csv');
  let drLine,dlLine;
  // Drive status from the same response
  if(d.driveOk){drLine='<span class="ok">\u2713 Saved to '+d.destinationLabel+' Drive</span> <span class="muted">as '+d.driveFileName+'</span>';}
  else{drLine='<span class="bad">\u2715 Drive save failed</span> <span class="muted">('+(d.driveError||'unknown error')+')</span>';}
  // Download the cleaned CSV returned in the response (no second upload)
  try{
    sProg('Downloading cleaned list...');
    const blob=new Blob([d.cleanedCsv||''],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=dlName;a.click();
    dlLine='<span class="ok">\u2713 Downloaded</span> <b>'+dlName+'</b>';
  }catch(e){dlLine='<span class="bad">\u2715 Download failed</span> <span class="muted">('+e.message+')</span>';}
  // Optional: columns-trimmed note
  let colLine='';
  if(d.droppedColumns&&d.droppedColumns>0){colLine='<div><span class="ok">\u2713 Trimmed columns</span> <span class="muted">kept '+(d.keptColumns?d.keptColumns.length:0)+', removed '+d.droppedColumns+'</span></div>';}
  // Progress line disappears; green checks take its place
  sProgDone();
  $('#s-drive-msg').innerHTML=colLine+'<div>'+drLine+'</div><div>'+dlLine+'</div>';
  $('#s-drive-msg').classList.remove('hide');
  // Button becomes a neutral "Scrub another"
  btn.textContent='Scrub another';btn.classList.add('ghost');btn.disabled=false;sMode='again';
  $('#s-result').scrollIntoView({behavior:'smooth'});
};

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
// run logs (dry-run, read-only) + project mapping (persisted to KV)
let rlPacs=[],rlDests=[];
function assignCell(project){
  var pid=project.replace(/[^a-z0-9]/gi,'_');
  var pacOpts='<option value="">Select...</option>'+rlPacs.map(function(p){return '<option value="'+p+'">'+p+'</option>';}).join('');
  var destOpts='<option value="">Select...</option>'+rlDests.map(function(dv){return '<option value="'+dv+'">'+dv+'</option>';}).join('');
  return '<span class="assign" data-project="'+encodeURIComponent(project)+'">'+
    '<span class="asg-field"><label>PAC</label><select class="asg-pac">'+pacOpts+'</select></span>'+
    '<span class="asg-field"><label>Destination</label><select class="asg-dest">'+destOpts+'</select></span>'+
    '<button class="btn asg-save" style="padding:6px 12px">Save</button>'+
    '<span class="asg-msg muted"></span></span>';
}
function wireAssigns(root){
  root.querySelectorAll('.asg-save').forEach(function(btn){
    btn.onclick=async function(){
      var box=btn.closest('.assign');
      var project=decodeURIComponent(box.dataset.project);
      var pac=box.querySelector('.asg-pac').value;
      var dest=box.querySelector('.asg-dest').value;
      var msg=box.querySelector('.asg-msg');
      if(!pac||!dest){msg.textContent='Pick both PAC and Destination.';return;}
      btn.disabled=true;msg.innerHTML='<span class="spin"></span>Saving...';
      try{
        var d=await jsonFetch('/api/mapping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:project,pac:pac,destination:dest})});
        if(!d.ok){msg.textContent='Failed: '+(d.error||'error');btn.disabled=false;return;}
        msg.textContent='Saved. Re-running...';
        loadRunlogs();
      }catch(e){msg.textContent='Failed: '+e.message;btn.disabled=false;}
    };
  });
}
$('#rl-run').onclick=loadRunlogs;
async function loadRunlogs(){
  const btn=$('#rl-run');const st=$('#rl-status');
  const startedAt=Date.now();
  btn.disabled=true;st.innerHTML='<span class="spin"></span>Refreshing optouts...';
  ['#rl-summary','#rl-groups-card','#rl-quar-card','#rl-proj-card'].forEach(id=>$(id).classList.add('hide'));
  // Single updating status line (spinner) streams live progress. If the stream
  // drops, we silently recover by polling the last saved run - no error shown.
  let d=null;
  try{
    const r=await fetch('/api/runlogs/dry-run');
    if(r.redirected && r.url.indexOf('/auth/login')>=0){window.location.href='/auth/login';return;}
    if(!r.body)throw new Error('no stream');
    const reader=r.body.getReader();const dec=new TextDecoder();let buf='';
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      let nl;
      while((nl=buf.indexOf('\\n'))>=0){
        const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);
        if(!line)continue;
        let ev;try{ev=JSON.parse(line);}catch(e){continue;}
        if(ev.type==='progress'){
          st.innerHTML='<span class="spin"></span>'+(ev.message||'Working...');
        }else if(ev.type==='done'){
          d=ev;
        }
        // ev.type==='error' falls through to silent recovery below.
      }
    }
  }catch(e){/* stream dropped - fall through to silent recovery */}
  // If we did not get a clean done event, recover silently: poll for the last
  // saved run newer than when we started. No mention of any failure.
  if(!d||!d.ok||!d.log){
    st.innerHTML='<span class="spin"></span>Refreshing optouts...';
    d=await recoverLastRun(startedAt);
  }
  btn.disabled=false;
  if(!d||!d.log){st.textContent='';return;} // give up quietly; history is source of truth
  st.textContent='';
  renderRunResult(d.log);
}
// Poll the last-saved run until one appears that is newer than startedAt.
async function recoverLastRun(startedAt){
  const deadline=startedAt+180000; // 3 min ceiling; a run takes ~80s
  while(Date.now()<deadline){
    try{
      const r=await jsonFetch('/api/runlogs/last');
      const last=r&&r.last;
      if(last&&last.log&&last.log.ranAt&&(new Date(last.log.ranAt).getTime()>=startedAt-5000)){
        return {ok:true,log:last.log,email:last.email};
      }
    }catch(e){}
    await new Promise(res=>setTimeout(res,4000));
  }
  return null;
}
async function renderRunResult(g){
  // load canonical option lists for assign dropdowns (once)
  try{var m=await jsonFetch('/api/mapping');rlPacs=m.pacSlugs||[];rlDests=m.destinations||[];}catch(e){}
  // load canonical option lists for assign dropdowns (once)
  try{var m=await jsonFetch('/api/mapping');rlPacs=m.pacSlugs||[];rlDests=m.destinations||[];}catch(e){}
  const newTotal=g.groups.reduce((s,x)=>s+x.newCount,0);
  const quarTotal=g.quarantined.reduce((s,x)=>s+x.count,0);
  $('#rl-meta').innerHTML='<span>Client: <b>'+g.client+'</b></span><span>Ran: <b>'+fmtDate(g.ranAt)+'</b></span><span>Total opt-outs: <b>'+g.totalCount.toLocaleString()+'</b></span>';
  $('#rl-stats').innerHTML=
    '<div class="stat"><div class="n good">'+newTotal.toLocaleString()+'</div><div class="l">New opt-outs</div></div>'+
    '<div class="stat"><div class="n">'+g.groups.length+'</div><div class="l">PAC+Destination groups</div></div>'+
    '<div class="stat"><div class="n warn">'+quarTotal.toLocaleString()+'</div><div class="l">Quarantined</div></div>'+
    '<div class="stat"><div class="n">'+g.projects.length+'</div><div class="l">Projects seen</div></div>';
  $('#rl-summary').classList.remove('hide');
  // groups
  let gh='<table><thead><tr><th>PAC</th><th>Destination</th><th style="text-align:right">Pulled (unique)</th><th style="text-align:right">Already reported</th><th style="text-align:right">New</th></tr></thead><tbody>';
  g.groups.forEach(x=>{gh+='<tr><td>'+x.pac+'</td><td>'+x.destination+'</td><td style="text-align:right">'+x.todayUnique.toLocaleString()+'</td><td style="text-align:right" class="muted">'+x.alreadyReported.toLocaleString()+'</td><td style="text-align:right;color:#4ade80">'+x.newCount.toLocaleString()+'</td></tr>';});
  gh+='</tbody></table>';
  if(g.groups.length===0)gh='<p class="muted">No mapped groups in this pull.</p>';
  $('#rl-groups').innerHTML=gh;$('#rl-groups-card').classList.remove('hide');
  // quarantine
  if(g.quarantined.length){
    let qh='<table class="qtable"><thead><tr><th class="q-proj">Project</th><th class="q-held">Opt-outs held</th><th class="q-assign"></th></tr></thead><tbody>';
    g.quarantined.forEach(x=>{qh+='<tr><td class="q-proj" title="'+x.project.replace(/"/g,'&quot;')+'">'+x.project+'</td><td class="q-held" style="color:var(--accent)">'+x.count.toLocaleString()+'</td><td class="q-assign">'+assignCell(x.project)+'</td></tr>';});
    qh+='</tbody></table>';
    $('#rl-quar').innerHTML=qh;$('#rl-quar-card').classList.remove('hide');
    wireAssigns($('#rl-quar'));
  }
  // all projects
  var icOk='<span class="ic ic-ok" title="Mapped"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  var icBlock='<span class="ic ic-block" title="Unmapped"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg></span>';
  var dash='<span class="muted">-</span>';
  let ph='<table class="ptable"><thead><tr><th class="c-stat">&nbsp;</th><th class="c-proj">Project</th><th class="c-pac">PAC</th><th class="c-dest">Destination</th><th class="c-new">New</th><th class="c-tot">Total</th></tr></thead><tbody>';
  g.projects.forEach(x=>{
    var mapped=x.status==='mapped';
    var icon=mapped?icOk:icBlock;
    var ttl=x.count.toLocaleString();
    var newCell=(mapped&&x.newCount!=null)?'<span class="nt-new">'+x.newCount.toLocaleString()+'</span>':dash;
    var title=mapped?('Mapped'+(x.source==='override'?' (assigned)':'')):'Unmapped';
    ph+='<tr><td class="c-stat" title="'+title+'">'+icon+'</td><td class="c-proj" title="'+x.project.replace(/"/g,'&quot;')+'">'+x.project+'</td><td class="c-pac">'+(x.pac||dash)+'</td><td class="c-dest">'+(x.destination||dash)+'</td><td class="c-new">'+newCell+'</td><td class="c-tot">'+ttl+'</td></tr>';
  });
  ph+='</tbody></table>';
  $('#rl-proj').innerHTML=ph;$('#rl-proj-card').classList.remove('hide');
  loadRunHistory();
}
async function loadRunHistory(){
  const el=$('#rl-hist');if(!el)return;
  let d;try{d=await jsonFetch('/api/runlogs/history');}catch(e){el.innerHTML='<span class="muted">Could not load history: '+e.message+'</span>';return;}
  const runs=(d&&d.runs)||[];
  if(!runs.length){el.innerHTML='<span class="muted">No runs yet. Hit Refresh Optouts.</span>';return;}
  var okIc='<span class="ic ic-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  var noIc='<span class="ic ic-block"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg></span>';
  function who(r){
    if(r.source&&r.source.indexOf('cron')>=0)return 'Chopper (automated)';
    if(r.triggeredBy==='Chopper (automated)')return 'Chopper (automated)';
    if(r.triggeredByName)return r.triggeredByName;
    if(r.triggeredBy&&r.triggeredBy.indexOf('@')>=0)return r.triggeredBy.split('@')[0];
    return r.triggeredBy||'unknown';
  }
  let h='<table class="htable"><thead><tr><th class="h-when">When</th><th class="h-by">Triggered by</th><th class="h-num">New</th><th class="h-num">Total</th><th class="h-num">Quarantined</th><th class="h-email">Email</th></tr></thead><tbody>';
  runs.forEach(function(r){
    var email=r.emailSent?okIc:(noIc+(r.emailError?' <span class="muted" title="'+String(r.emailError).replace(/"/g,"&quot;")+'">failed</span>':''));
    var q=r.quarantinedProjects?('<span style="color:var(--accent)">'+r.quarantinedOptOuts.toLocaleString()+'</span> <span class="muted">('+r.quarantinedProjects+')</span>'):'<span class="muted">0</span>';
    h+='<tr><td class="h-when">'+fmtDate(r.ranAt)+'</td><td class="h-by">'+who(r)+'</td><td class="h-num" style="color:#4ade80">'+r.newTotal.toLocaleString()+'</td><td class="h-num muted">'+r.totalCount.toLocaleString()+'</td><td class="h-num">'+q+'</td><td class="h-email">'+email+'</td></tr>';
  });
  h+='</tbody></table>';
  el.innerHTML=h;
}
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
        var nm=f.link?('<a href="'+f.link+'" target="_blank" rel="noopener">'+f.name+'</a>'):f.name;
        html+='<tr><td class="c-file">'+nm+'</td><td class="c-size">'+(f.size!=null?fmtBytes(f.size):'-')+'</td><td class="c-date muted">'+fmtDate(f.modifiedTime)+'</td></tr>';
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
