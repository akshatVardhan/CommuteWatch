// ─── CONFIG ───────────────────────────────────────────────────────────────────
const AUTO_REFRESH = 8 * 60 * 1000;

const ROUTES = {
  morning:{
    id:"morning", label:"Home → Office", emoji:"🏠→🏢",
    fromLabel:"Shree Awas Apartments, Dwarka Sec 19",
    toLabel:"Ameriprise Financial, Sector 18, Gurugram",
    expyColor:"#06b6d4",
    mapsExpy:"https://www.google.com/maps/dir/28.5733,77.0579/28.4595,77.0266/@28.516,77.043,13z?travelmode=driving",
    mapsBij:"https://www.google.com/maps/dir/28.5733,77.0579/28.5094,77.0630/28.4595,77.0266/@28.516,77.043,12z?travelmode=driving",
    checkpoints:[
      {id:"cp1",label:"Sector 21 merge",    sublabel:"Entry onto expressway from Dwarka",         isCritical:false},
      {id:"cp2",label:"Mid-expressway",      sublabel:"Tunnel stretch begins",                      isCritical:false},
      {id:"cp3",label:"Last tunnel exit ⚠️", sublabel:"NH-48 merge — Sheetla Mata (90% jam risk)", isCritical:true},
    ],
    aiCtx:`MORNING (Home→Office): Shree Awas Apartments Dwarka → Ameriprise Financial Sector 18 Gurugram (19km).
Baseline: Expy 32min clear, Bijwasan 37min clear.
Critical: LAST TUNNEL EXIT onto NH-48 (Sheetla Mata/Kherki Daula) — 90% jam at peak.
Checkpoints: (1) Sector 21 merge → (2) mid-expressway → (3) last tunnel exit [CRITICAL].
Rule: take Bijwasan only if Expy is 10–15+ min slower.`,
  },
  evening:{
    id:"evening", label:"Office → Home", emoji:"🏢→🏠",
    fromLabel:"Ameriprise Financial, Sector 18, Gurugram",
    toLabel:"Shree Awas Apartments, Dwarka Sec 19",
    expyColor:"#f97316",
    mapsExpy:"https://www.google.com/maps/dir/28.4595,77.0266/28.5733,77.0579/@28.516,77.043,13z?travelmode=driving",
    mapsBij:"https://www.google.com/maps/dir/28.4595,77.0266/28.5094,77.0630/28.5733,77.0579/@28.516,77.043,12z?travelmode=driving",
    checkpoints:[
      {id:"cp1",label:"NH-48 → Expy entry ⚠️",sublabel:"Gurugram merge — worst evening bottleneck",isCritical:true},
      {id:"cp2",label:"Tunnel section",         sublabel:"Through the expressway tunnels",           isCritical:false},
      {id:"cp3",label:"Sector 21 exit",         sublabel:"Exiting expressway into Dwarka",           isCritical:false},
    ],
    aiCtx:`EVENING (Office→Home): Ameriprise Financial Sector 18 Gurugram → Shree Awas Apartments Dwarka (19km).
Baseline: Expy 35min clear, Bijwasan 40min clear.
Critical: NH-48 → Dwarka Expressway ENTRY from Gurugram side — worst evening congestion.
Checkpoints: (1) NH-48 entry [CRITICAL] → (2) tunnel section → (3) Sector 21 exit.
Rule: take Bijwasan only if Expy is 10–15+ min slower.`,
  },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let tab    = new Date().getHours() < 14 ? "morning" : "evening";
let logs   = {morningLog:[], eveningLog:[]};
let res    = {morning:null, evening:null};
let busy   = false;
let lastTs = null;
let weather= null;
let wxBusy = false;
let mform  = {cp1:"moderate",cp2:"moderate",cp3:"heavy",routeTaken:"expressway"};
let deferredInstallPrompt = null;

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function load(){
  try{
    const s=localStorage.getItem("cw10");
    if(s){
      const p=JSON.parse(s);
      logs=p.logs||logs; res=p.res||res; lastTs=p.lastTs||null; weather=p.weather||null;
    }
  }catch{}
}
function save(){
  try{ localStorage.setItem("cw10",JSON.stringify({logs,res,lastTs,weather})); }catch{}
}

// ─── API KEY ──────────────────────────────────────────────────────────────────
function getApiKey(){ return localStorage.getItem("cw_apikey")||""; }

function saveKey(){
  const v=(document.getElementById("key-input").value||"").trim();
  if(!v){ toast("⚠️ Enter an API key first"); return; }
  if(!v.startsWith("sk-")){ toast("⚠️ Key should start with sk-"); return; }
  localStorage.setItem("cw_apikey",v);
  updateKeyStatus();
  closeSettings();
  toast("✅ API key saved");
  if(res[tab]?.error==="no-api-key"||res[tab]?.error==="invalid-api-key") doFetch(false);
}

function clearKey(){
  if(!confirm("Remove the saved API key?")) return;
  localStorage.removeItem("cw_apikey");
  document.getElementById("key-input").value="";
  updateKeyStatus();
  toast("🗑 API key cleared");
}

function toggleKeyVis(){
  const inp=document.getElementById("key-input"),btn=document.getElementById("key-vis-btn");
  if(inp.type==="password"){inp.type="text";btn.textContent="Hide";}
  else{inp.type="password";btn.textContent="Show";}
}

function updateKeyStatus(){
  const k=getApiKey(),el=document.getElementById("key-status");
  if(!el) return;
  if(k){
    const masked=k.slice(0,12)+"…"+k.slice(-4);
    el.innerHTML=`<span style="color:#10b981;font-weight:700;">✓ Key saved:</span> <span style="font-family:monospace;font-size:11px;color:#475569;">${masked}</span>`;
  }else{
    el.innerHTML=`<span style="color:#ef4444;font-weight:700;">✗ No key set</span> — analysis won't work without it.`;
  }
}

// ─── HOLIDAYS ─────────────────────────────────────────────────────────────────
// Fixed annual (M/D without leading zeros)
const HOLIDAY_FIXED = {
  "1/26":"Republic Day",
  "4/14":"Dr. Ambedkar Jayanti",
  "8/15":"Independence Day",
  "10/2":"Gandhi Jayanti",
  "12/25":"Christmas",
};
// Year-specific (YYYY/M/D) — lunar/approximate dates
const HOLIDAY_YEAR = {
  "2025/3/14":"Holi","2025/3/31":"Eid ul-Fitr","2025/4/18":"Good Friday",
  "2025/5/12":"Buddha Purnima","2025/6/7":"Eid ul-Adha","2025/8/27":"Janmashtami",
  "2025/10/20":"Diwali","2025/11/5":"Guru Nanak Jayanti",
  "2026/3/3":"Holi","2026/4/3":"Good Friday","2026/10/19":"Dussehra",
  "2026/11/8":"Diwali","2026/11/24":"Guru Nanak Jayanti",
};

function getTodayHoliday(d=new Date()){
  const fk=`${d.getMonth()+1}/${d.getDate()}`;
  const yk=`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  return HOLIDAY_FIXED[fk]||HOLIDAY_YEAR[yk]||null;
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────
const WX_CACHE = 30 * 60 * 1000;

// WMO weather interpretation — covers codes relevant to Delhi-NCR
const WX_MAP = [
  [0,   "Clear sky",      "☀️",  "low"],
  [1,   "Mainly clear",   "🌤️",  "low"],
  [2,   "Partly cloudy",  "⛅",  "low"],
  [3,   "Overcast",       "☁️",  "low"],
  [45,  "Fog",            "🌫️",  "high"],
  [48,  "Rime fog",       "🌫️",  "high"],
  [51,  "Light drizzle",  "🌦️",  "moderate"],
  [53,  "Drizzle",        "🌧️",  "moderate"],
  [55,  "Heavy drizzle",  "🌧️",  "high"],
  [61,  "Light rain",     "🌧️",  "moderate"],
  [63,  "Rain",           "🌧️",  "high"],
  [65,  "Heavy rain",     "⛈️",  "high"],
  [71,  "Light snow",     "🌨️",  "high"],
  [80,  "Rain showers",   "🌦️",  "moderate"],
  [81,  "Showers",        "🌧️",  "high"],
  [82,  "Heavy showers",  "⛈️",  "high"],
  [95,  "Thunderstorm",   "⛈️",  "high"],
  [99,  "Thunderstorm",   "⛈️",  "high"],
];

function getWxInfo(code, vis=10000){
  // Walk backwards to find the largest matching code ≤ given code
  const entry = [...WX_MAP].reverse().find(([c])=>c<=code) || WX_MAP[0];
  let [,label,emoji,impact] = entry;
  // Boost impact for very poor visibility (Delhi winter fog / dust)
  if(vis < 200)  return {label, emoji, impact:"extreme"};
  if(vis < 1000 && impact!=="high") impact="high";
  return {label, emoji, impact};
}

async function fetchWeather(){
  if(wxBusy) return;
  if(weather && (Date.now()-weather.ts) < WX_CACHE) return;
  if(!navigator.onLine) return;
  wxBusy=true;
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(), 8000);
    const r=await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=28.52&longitude=77.04&current=temperature_2m,weathercode,visibility,precipitation,windspeed_10m&timezone=Asia%2FKolkata",
      {signal:ctrl.signal}
    );
    if(!r.ok) throw new Error("wx");
    const d=await r.json();
    const c=d.current;
    const vis=c.visibility??10000;
    const wi=getWxInfo(c.weathercode??0, vis);
    weather={
      temp:Math.round(c.temperature_2m),
      code:c.weathercode,
      label:wi.label, emoji:wi.emoji, impact:wi.impact,
      visibility:vis,
      precipitation:c.precipitation??0,
      ts:Date.now(),
    };
    save();
    renderPanel();
  }catch{ /* weather is a nice-to-have — fail silently */ }
  wxBusy=false;
}

// ─── DAY PATTERNS ─────────────────────────────────────────────────────────────
function getDayPatterns(direction){
  const log=logs[`${direction}Log`]||[];
  const byDay={};
  log.forEach(e=>{
    const mins=Number(e.actualMinutes);
    if(!mins||!e.date) return;
    const day=e.date.split(",")[0].trim(); // "Mon", "Tue", etc.
    if(!byDay[day]) byDay[day]={total:0,count:0};
    byDay[day].total+=mins;
    byDay[day].count++;
  });
  const ORDER=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return Object.entries(byDay)
    .filter(([,v])=>v.count>=2)
    .map(([day,v])=>({day, avg:Math.round(v.total/v.count), count:v.count}))
    .sort((a,b)=>ORDER.indexOf(a.day)-ORDER.indexOf(b.day));
}

// Returns a compact text string for the AI prompt
function dayPatternsPromptText(direction){
  const p=getDayPatterns(direction);
  if(!p.length) return "";
  return "USER DAY PATTERNS (≥2 trips each): "+p.map(({day,avg,count})=>`${day} avg ${avg}min (${count} trips)`).join(", ");
}

// ─── DEPARTURE ADVISOR ────────────────────────────────────────────────────────
function getDepartureAdvisor(d=new Date()){
  const frac=d.getHours()+d.getMinutes()/60;
  const holiday=getTodayHoliday(d);

  if(d.getDay()===0||d.getDay()===6)
    return {icon:"🟢",title:"Weekend",msg:"Light traffic expected all day — roads should flow freely.",color:"#10b981",bg:"#10b98112",border:"#10b98130"};

  if(holiday)
    return {icon:"🎉",title:holiday,msg:"Public holiday — significantly lighter traffic than a normal workday.",color:"#10b981",bg:"#10b98112",border:"#10b98130"};

  if(tab==="morning"){
    if(frac<6||frac>12) return null;
    if(frac<7.5)
      return {icon:"🟢",title:"Clear window",msg:"Roads are free-flowing — smooth ~32 min Expy run expected.",color:"#10b981",bg:"#10b98112",border:"#10b98130"};
    if(frac<8){
      const left=Math.round((8-frac)*60);
      return {icon:"⏳",title:`Rush in ~${left} min`,msg:"Morning rush peaks 8–10 AM. Leave now for the best window, or wait until after 10:30.",color:"#f59e0b",bg:"#f59e0b12",border:"#f59e0b30"};
    }
    if(frac<=10)
      return {icon:"⚠️",title:"Morning rush active",msg:"Kherki Daula bottleneck likely heavy. Bijwasan often saves 10+ min right now.",color:"#ef4444",bg:"#ef444412",border:"#ef444430"};
    if(frac<=11)
      return {icon:"⏳",title:"Rush winding down",msg:"Traffic clearing. Roads should be smooth within 30 min.",color:"#f59e0b",bg:"#f59e0b12",border:"#f59e0b30"};
    return null;
  }

  if(tab==="evening"){
    if(frac<15||frac>22) return null;
    if(frac<17)
      return {icon:"🟢",title:"Clear window",msg:"Afternoon roads free-flowing — smooth ~35 min Expy run expected.",color:"#10b981",bg:"#10b98112",border:"#10b98130"};
    if(frac<17.5){
      const left=Math.round((17.5-frac)*60);
      return {icon:"⏳",title:`Rush in ~${left} min`,msg:"Evening rush peaks 5:30–8:30 PM. Leave now for smooth flow, or wait until after 9 PM.",color:"#f59e0b",bg:"#f59e0b12",border:"#f59e0b30"};
    }
    if(frac<=20.5)
      return {icon:"⚠️",title:"Evening rush active",msg:"NH-48 entry from Gurugram is likely congested. Check both routes before heading out.",color:"#ef4444",bg:"#ef444412",border:"#ef444430"};
    if(frac<=21.5)
      return {icon:"⏳",title:"Rush winding down",msg:"Traffic clearing. Roads should be smooth by 9:30 PM.",color:"#f59e0b",bg:"#f59e0b12",border:"#f59e0b30"};
    if(frac<=22)
      return {icon:"🟢",title:"Clear now",msg:"Evening rush has ended. Roads flowing freely.",color:"#10b981",bg:"#10b98112",border:"#10b98130"};
    return null;
  }
  return null;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const ft = d=>d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true});
const fd = d=>d.toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});

function getPeakInfo(d=new Date()){
  const h=d.getHours(),m=d.getMinutes(),frac=h+m/60;
  if(d.getDay()===0||d.getDay()===6) return {peak:false,label:"● Off-peak · Weekend",color:"#10b981"};
  const holiday=getTodayHoliday(d);
  if(holiday) return {peak:false,label:`● Off-peak · ${holiday}`,color:"#10b981"};
  if(frac>=8   &&frac<=10.5) return {peak:true, label:"● Morning rush",        color:"#ef4444"};
  if(frac>=17.5&&frac<=21)   return {peak:true, label:"● Evening rush",        color:"#ef4444"};
  if(frac>=7.5 &&frac<8)    return {peak:false,label:"● Rush starting soon",  color:"#f59e0b"};
  if(frac>10.5 &&frac<=11)  return {peak:false,label:"● Rush winding down",   color:"#f59e0b"};
  if(frac>=17  &&frac<17.5) return {peak:false,label:"● Rush starting soon",  color:"#f59e0b"};
  if(frac>21   &&frac<=21.5)return {peak:false,label:"● Rush winding down",   color:"#f59e0b"};
  return {peak:false,label:"● Off-peak",color:"#10b981"};
}

const wk  = (d=new Date())=>d.getDay()===0||d.getDay()===6;
const ago = ts=>{const m=Math.floor((Date.now()-ts)/60000);return m<1?"just now":m===1?"1 min ago":`${m} min ago`;};
const BL  = {clear:"Clear",moderate:"Moderate",heavy:"Heavy",unknown:"—"};
const DC  = {clear:"#10b981",moderate:"#f59e0b",heavy:"#ef4444",unknown:"#475569"};
const TC  = {clear:"#065f46",moderate:"#92400e",heavy:"#991b1b",unknown:"#64748b"};

function errMsg(code){
  const map={
    "offline":         "You're offline. Connect to get a fresh analysis.",
    "no-api-key":      "API key not set. Add your Anthropic API key in Settings.",
    "invalid-api-key": "Invalid API key. Check your key in Settings.",
    "rate-limited":    "Rate limited by Claude API. Wait a minute and try again.",
    "quota-exceeded":  "API quota exceeded. Check your Anthropic account.",
    "timeout":         "Request timed out (15s). Check your connection and retry.",
    "bad-response":    "Unexpected response format from AI. Try again.",
  };
  return map[code]||`Analysis failed: ${code}`;
}

// ─── OFFLINE DETECTION ────────────────────────────────────────────────────────
function updateOnlineStatus(){ document.body.classList.toggle("offline",!navigator.onLine); }
window.addEventListener("online",  updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ─── CLOCK ────────────────────────────────────────────────────────────────────
function tick(){
  const now=new Date(),pi=getPeakInfo(now);
  document.getElementById("clock-line").innerHTML=
    `${fd(now)} · ${ft(now)} <span style="margin-left:6px;color:${pi.color};font-weight:700;">${pi.label}</span>`;
  const sug=now.getHours()<14?"morning":"evening";
  document.getElementById("tab-hint").innerHTML=sug!==tab
    ?`<button onclick="switchTab('${sug}')" class="tap-btn" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:5px 10px;font-size:11px;color:#f59e0b;font-weight:700;font-family:inherit;">Switch →</button>`:"";
}
setInterval(tick,30000); tick();

// ─── CLAUDE ANALYSIS ──────────────────────────────────────────────────────────
async function analyse(){
  const apiKey=getApiKey();
  if(!apiKey){ openSettings(); throw new Error("no-api-key"); }
  if(!navigator.onLine) throw new Error("offline");

  const cfg=ROUTES[tab],now=new Date(),pi=getPeakInfo(now);
  const holiday=getTodayHoliday(now);

  // Training log context
  const tlog=(logs[`${tab}Log`]||[]).slice(-10).reverse();
  const tctx=tlog.length
    ?"USER TRAINING DATA (most recent first):\n"+tlog.map(l=>`- ${l.date} ${l.time}: CP1=${l.cp1}, CP2=${l.cp2}, CP3=${l.cp3}, took ${l.routeTaken}, actual=${l.actualMinutes}min. Notes:"${l.notes}"`).join("\n")
    :"No training data yet — use typical Delhi-NCR patterns.";

  // Weather context
  const wxLine = weather
    ? `WEATHER: ${weather.emoji} ${weather.label}, ${weather.temp}°C`+
      (weather.visibility<5000?`, visibility ${(weather.visibility/1000).toFixed(1)}km`:"")+
      (weather.impact==="extreme"?" — SEVERE CONDITIONS, add 20-30min to all estimates":
       weather.impact==="high"?" — adverse conditions, add 10-15min to all estimates":
       weather.impact==="moderate"?" — minor delays expected":"")
    : "WEATHER: unavailable";

  // Day patterns context
  const dpText=dayPatternsPromptText(tab);

  const prompt=`You are a hyperlocal Delhi-NCR traffic intelligence system.

${cfg.aiCtx}

TIME: ${ft(now)} on ${now.toLocaleDateString("en-IN",{weekday:"long"})}
PEAK STATUS: ${pi.peak?"IN PEAK RUSH HOUR":"off-peak"} | WEEKEND: ${wk(now)?"YES":"NO"}
${holiday?`HOLIDAY: ${holiday} today — significantly lighter traffic than a normal weekday.`:""}
${wxLine}
${dpText}

${tctx}

Give a realistic assessment. During peak hours and bad weather, be honest about delays at critical checkpoints.

Respond ONLY in exact JSON (no markdown):
{
  "expy":{"estimatedMin":<n>,"delayMin":<n>,"overall":"clear|moderate|heavy","checkpoints":{"cp1":{"status":"clear|moderate|heavy","note":"<6 words>"},"cp2":{"status":"clear|moderate|heavy","note":"<6 words>"},"cp3":{"status":"clear|moderate|heavy","note":"<8 words>"}}},
  "bij":{"estimatedMin":<n>,"delayMin":<n>,"overall":"clear|moderate|heavy"},
  "recommendation":"expressway|bijwasan",
  "timeDelta":<expy min - bij min>,
  "verdict":"<max 15 words, mention estimated minutes>",
  "tip":"<max 18 words, practical>"
}`;

  const controller=new AbortController();
  const tid=setTimeout(()=>controller.abort(),15000);
  let r;
  try{
    r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      signal:controller.signal,
      headers:{
        "Content-Type":"application/json",
        "x-api-key":apiKey,
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true",
      },
      body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:700,messages:[{role:"user",content:prompt}]}),
    });
  }catch(e){
    clearTimeout(tid);
    throw new Error(e.name==="AbortError"?"timeout":"offline");
  }
  clearTimeout(tid);

  if(r.status===401) throw new Error("invalid-api-key");
  if(r.status===429) throw new Error("rate-limited");
  if(r.status===529||r.status===503) throw new Error("api-error-"+r.status);
  if(!r.ok) throw new Error("api-error-"+r.status);

  let d;
  try{ d=await r.json(); }catch{ throw new Error("bad-response"); }
  if(d.error) throw new Error(d.error.type==="authentication_error"?"invalid-api-key":d.error.message||"api-error");

  const text=(d.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
  if(!text) throw new Error("bad-response");
  try{ return JSON.parse(text); }catch{ throw new Error("bad-response"); }
}

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function doFetch(silent=false){
  if(busy) return;
  if(!navigator.onLine){
    if(!silent) toast("📵 Offline — showing cached analysis");
    renderPanel(); return;
  }
  if(silent&&!getApiKey()) return;

  fetchWeather(); // fire-and-forget; renders when done

  busy=true;
  if(!silent) renderPanel();
  try{
    const data=await analyse();
    res[tab]={data,ts:Date.now()};
    lastTs=Date.now();
    save();
  }catch(e){
    const code=e.message||"unknown";
    if(code!=="offline") res[tab]={error:code,ts:Date.now()};
  }
  busy=false;
  renderPanel();
}
setInterval(()=>doFetch(true), AUTO_REFRESH);

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderPanel(){
  const cfg=ROUTES[tab],r=res[tab],ac=cfg.expyColor,log=logs[`${tab}Log`]||[];
  const now=new Date();
  let h="";

  // Route strip — with weather footer
  const wxFooter = weather
    ? (()=>{
        const vis=weather.visibility;
        const visStr=vis<10000?` · ${(vis/1000).toFixed(1)}km vis`:"";
        const impactColor=weather.impact==="extreme"?"#ef4444":weather.impact==="high"?"#ef4444":weather.impact==="moderate"?"#f59e0b":null;
        const impactBadge=impactColor
          ?`<span style="font-size:10px;background:${impactColor}22;color:${impactColor};border-radius:6px;padding:2px 7px;font-weight:700;">${weather.impact==="extreme"?"⚠️ severe delays":"adds delays"}</span>`
          :"";
        return `<div style="border-top:1px solid #0f172a;margin-top:8px;padding-top:8px;display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;color:#64748b;">${weather.emoji} ${weather.label} · ${weather.temp}°C${visStr}</span>
          ${impactBadge}
        </div>`;
      })()
    : wxBusy
      ? `<div style="border-top:1px solid #0f172a;margin-top:8px;padding-top:8px;font-size:11px;color:#334155;display:flex;align-items:center;gap:5px;"><span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span> Loading weather…</div>`
      : "";

  h+=`<div style="background:#1e293b;border-radius:12px;padding:11px 13px;margin-bottom:12px;border:1px solid #334155;">
    <div style="font-size:11px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px;">Route</div>
    <div style="font-size:12px;color:#94a3b8;line-height:1.7;">
      <span style="color:#64748b;">From</span> ${cfg.fromLabel}<br>
      <span style="color:#64748b;">To&nbsp;&nbsp;&nbsp;&nbsp;</span> ${cfg.toLabel}
    </div>
    ${wxFooter}
  </div>`;

  // Departure advisor
  const adv=getDepartureAdvisor(now);
  if(adv){
    h+=`<div style="background:${adv.bg};border:1px solid ${adv.border};border-radius:12px;padding:11px 13px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;">
      <span style="font-size:18px;line-height:1.3;">${adv.icon}</span>
      <div>
        <div style="font-size:12px;font-weight:700;color:${adv.color};margin-bottom:2px;">${adv.title}</div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.5;">${adv.msg}</div>
      </div>
    </div>`;
  }

  // Action bar
  h+=`<div style="display:flex;gap:8px;margin-bottom:10px;">
    <button onclick="doFetch(false)" ${busy?"disabled":""} class="tap-btn"
      style="flex:1;background:${busy?"#1e293b":`linear-gradient(135deg,${ac},#0284c7)`};color:${busy?"#475569":"#fff"};border:${busy?"1px solid #334155":"none"};border-radius:12px;padding:13px 0;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;">
      ${busy?`<span class="spinner"></span> Analysing…`:"⚡ Check Traffic"}
    </button>
    <button onclick="openT()" class="tap-btn" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:13px 14px;color:#94a3b8;font-weight:700;font-size:13px;font-family:inherit;">+ Log</button>
  </div>`;

  // Status line
  const isStale=lastTs&&(Date.now()-lastTs)>20*60*1000;
  h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
    <span style="font-size:11px;color:#475569;display:flex;align-items:center;gap:4px;">
      <span style="color:${busy?"#f59e0b":navigator.onLine?"#10b981":"#ef4444"};font-size:9px;">●</span>
      ${busy?"Analysing…":!navigator.onLine?"Offline — cached":lastTs?`Updated ${ago(lastTs)}${isStale?" · may be stale":""}`:"Tap Check Traffic"}
    </span>
    <span style="font-size:10px;color:#334155;">Auto-refresh every 8 min</span>
  </div>`;

  // Error card
  if(r?.error){
    const isKeyErr=r.error==="no-api-key"||r.error==="invalid-api-key";
    h+=`<div style="background:#7f1d1d22;border:1px solid #ef444433;border-radius:12px;padding:12px 14px;margin-bottom:12px;">
      <div style="font-size:13px;color:#fca5a5;">⚠️ ${errMsg(r.error)}</div>
      ${isKeyErr?`<button onclick="openSettings()" style="display:inline-block;margin-top:8px;background:#ef444422;border:1px solid #ef444444;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;color:#fca5a5;font-family:inherit;">⚙️ Open Settings →</button>`:""}
      ${(!isKeyErr&&r.error!=="offline")?`<button onclick="doFetch(false)" style="display:inline-block;margin-top:8px;${isKeyErr?"margin-left:8px;":""}background:#1e293b;border:1px solid #334155;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;color:#94a3b8;font-family:inherit;">↺ Retry</button>`:""}
    </div>`;
  }

  // Skeleton
  if(busy&&!r?.data){
    h+=`<div class="skel" style="height:90px;margin-bottom:10px;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="skel" style="height:100px;"></div><div class="skel" style="height:100px;"></div>
    </div>
    <div class="skel" style="height:180px;margin-bottom:10px;"></div>`;
  }

  if(r?.data){
    const {expy,bij,recommendation:rec,timeDelta:delta,verdict,tip}=r.data;

    // Verdict card
    h+=`<div style="background:${rec==="expressway"?`linear-gradient(135deg,${ac}22,${ac}0d)`:"linear-gradient(135deg,#4c1d9540,#4c1d9520)"};border-radius:14px;padding:14px 15px;margin-bottom:12px;border:1.5px solid ${rec==="expressway"?ac+"55":"#7c3aed55"};">
      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Recommendation</div>
      <div style="font-weight:800;font-size:18px;color:#f1f5f9;margin-bottom:4px;">${rec==="expressway"?"🛣 Take Dwarka Expressway":"🔄 Take Bijwasan Bypass"}</div>
      <div style="font-size:13px;color:#94a3b8;line-height:1.5;margin-bottom:8px;">${verdict||""}</div>
      <div style="display:inline-block;background:rgba(255,255,255,0.07);border-radius:8px;padding:4px 10px;font-size:12px;color:#94a3b8;font-weight:600;">
        ${delta>0?`Expy ~${delta} min slower`:delta<0?`Expy ~${Math.abs(delta)} min faster`:"Both routes equal"} right now
      </div>
    </div>`;

    // ETA cards
    h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <div style="background:#1e293b;border-radius:12px;padding:12px 13px;border:${rec==="expressway"?`2px solid ${ac}`:"1px solid #334155"};">
        <div style="font-size:10px;font-weight:700;color:${rec==="expressway"?ac:"#475569"};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">🛣 Expy</div>
        <div style="font-size:28px;font-weight:800;color:#f1f5f9;letter-spacing:-1px;line-height:1;">${expy.estimatedMin}<span style="font-size:13px;font-weight:500;color:#475569;"> min</span></div>
        <div style="font-size:11px;color:#334155;margin:3px 0 6px;">${expy.delayMin>0?`+${expy.delayMin} min above baseline`:"Near free-flow"}</div>
        <span class="badge badge-${expy.overall}">${BL[expy.overall]||"—"}</span>
      </div>
      <div style="background:#1e293b;border-radius:12px;padding:12px 13px;border:${rec==="bijwasan"?"2px solid #8b5cf6":"1px solid #334155"};">
        <div style="font-size:10px;font-weight:700;color:${rec==="bijwasan"?"#a78bfa":"#475569"};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">🔄 Bijwasan</div>
        <div style="font-size:28px;font-weight:800;color:#f1f5f9;letter-spacing:-1px;line-height:1;">${bij.estimatedMin}<span style="font-size:13px;font-weight:500;color:#475569;"> min</span></div>
        <div style="font-size:11px;color:#334155;margin:3px 0 6px;">${bij.delayMin>0?`+${bij.delayMin} min above baseline`:"Near free-flow"}</div>
        <span class="badge badge-${bij.overall}">${BL[bij.overall]||"—"}</span>
      </div>
    </div>`;

    // Checkpoints
    h+=`<div style="background:#1e293b;border-radius:14px;padding:13px;margin-bottom:12px;border:1px solid #334155;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;">
        <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.8px;">🛣 Checkpoints</div>
        <div style="font-size:10px;color:#334155;">AI · pattern-based</div>
      </div>`;
    cfg.checkpoints.forEach((cp,i)=>{
      const cpd=expy.checkpoints?.[cp.id]||{},s=cpd.status||"unknown";
      h+=`<div style="display:flex;align-items:flex-start;gap:10px;position:relative;">
        ${i<cfg.checkpoints.length-1?`<div style="position:absolute;left:5px;top:18px;width:2px;height:calc(100% + 4px);background:#0f172a;"></div>`:""}
        <div style="padding-top:3px;flex-shrink:0;z-index:1;"><span class="dot dot-${s}" style="width:12px;height:12px;"></span></div>
        <div style="flex:1;background:${cp.isCritical?DC[s]+"12":"#0f172a"};border-radius:10px;padding:8px 10px;margin-bottom:6px;border:${cp.isCritical?`1.5px solid ${DC[s]}44`:"1px solid #0f172a"};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;font-weight:700;color:#f1f5f9;">${cp.label}</span>
              ${cp.isCritical?`<span style="font-size:10px;background:#7f1d1d;color:#fca5a5;padding:1px 6px;border-radius:10px;font-weight:700;">HIGH RISK</span>`:""}
            </div>
            <span class="badge badge-${s}">${BL[s]}</span>
          </div>
          <div style="font-size:11px;color:#475569;margin-top:2px;">${cp.sublabel}</div>
          ${cpd.note?`<div style="font-size:11px;color:${TC[s]};font-weight:600;margin-top:3px;">${cpd.note}</div>`:""}
        </div>
      </div>`;
    });
    h+=`</div>`;

    if(tip) h+=`<div style="background:#1e293b;border-radius:12px;padding:10px 13px;margin-bottom:12px;border:1px solid #334155;display:flex;gap:10px;align-items:flex-start;">
      <span>💡</span><div style="font-size:12px;color:#64748b;line-height:1.6;">${tip}</div>
    </div>`;

    h+=`<div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:#334155;text-align:center;line-height:1.6;">
      ⚠️ AI estimates based on time, weather & training data — not a live feed.<br>Tap Maps buttons below for real-time traffic.
    </div>`;
  }

  // Maps buttons
  h+=`<div style="margin-bottom:6px;font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.8px;">Open with live traffic in Google Maps</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
    <a href="${cfg.mapsExpy}" target="_blank" class="tap-btn" style="background:${ac}18;border:1.5px solid ${ac}44;border-radius:11px;padding:12px 0;text-align:center;font-size:13px;font-weight:700;color:${ac};display:block;">🛣 Expy Route</a>
    <a href="${cfg.mapsBij}"  target="_blank" class="tap-btn" style="background:#2d1b6920;border:1.5px solid #7c3aed44;border-radius:11px;padding:12px 0;text-align:center;font-size:13px;font-weight:700;color:#a78bfa;display:block;">🔄 Bijwasan Route</a>
  </div>`;

  // Training log — with day patterns summary
  const patterns=getDayPatterns(tab);
  h+=`<button onclick="toggleLog()" id="ltbtn" class="tap-btn" style="width:100%;background:none;border:1px solid #1e293b;border-radius:10px;padding:9px 0;color:#334155;font-weight:600;font-size:12px;margin-bottom:8px;font-family:inherit;">
    ▼ Training log (${log.length} entries)
  </button>
  <div id="lpanel" style="display:none;background:#1e293b;border-radius:12px;padding:13px;border:1px solid #334155;margin-bottom:14px;">`;

  if(!log.length){
    h+=`<div style="font-size:13px;color:#334155;text-align:center;padding:12px 0;">No logs yet.<br>Tap "+ Log" after each commute — AI gets smarter every time.</div>`;
  }else{
    [...log].reverse().slice(0,7).forEach(e=>{
      const rc=e.routeTaken==="expressway"?cfg.expyColor:"#a78bfa";
      h+=`<div style="background:#0f172a;border-radius:9px;padding:9px 11px;border:1px solid #1e293b;font-size:12px;margin-bottom:7px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span style="color:#475569;font-weight:600;">${e.date} ${e.time}</span>
          <span style="color:${rc};font-weight:700;">${e.routeTaken==="expressway"?"🛣 Expy":"🔄 Bijwasan"}</span>
        </div>
        <div style="color:#334155;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
          ${["cp1","cp2","cp3"].map(k=>e[k]?`<span style="display:flex;align-items:center;gap:3px;"><span class="dot dot-${e[k]}" style="width:7px;height:7px;"></span><span style="font-size:10px;">${k.toUpperCase()}</span></span>`:"").join("")}
          ${e.actualMinutes?`<span style="color:#475569;">${e.actualMinutes} min actual</span>`:""}
        </div>
        ${e.notes?`<div style="color:#334155;font-style:italic;font-size:11px;">"${e.notes}"</div>`:""}
      </div>`;
    });
    if(log.length>7) h+=`<div style="font-size:11px;color:#1e293b;text-align:center;padding-top:4px;">+ ${log.length-7} older entries</div>`;

    // Day patterns — only shown when we have enough data
    if(patterns.length){
      // Find min/max avg for colour coding
      const avgs=patterns.map(p=>p.avg);
      const minAvg=Math.min(...avgs), maxAvg=Math.max(...avgs);
      h+=`<div style="border-top:1px solid #0f172a;margin-top:8px;padding-top:10px;">
        <div style="font-size:10px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:7px;">Your patterns by day</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      patterns.forEach(({day,avg,count})=>{
        const ratio=(avg-minAvg)/Math.max(maxAvg-minAvg,1);
        const col=ratio>0.66?"#ef4444":ratio>0.33?"#f59e0b":"#10b981";
        h+=`<div style="background:#0f172a;border:1px solid ${col}44;border-radius:8px;padding:5px 9px;text-align:center;">
          <div style="font-size:10px;color:#475569;font-weight:600;">${day}</div>
          <div style="font-size:13px;font-weight:800;color:${col};">${avg}<span style="font-size:9px;font-weight:500;color:#334155;">m</span></div>
          <div style="font-size:9px;color:#334155;">${count} trips</div>
        </div>`;
      });
      h+=`</div></div>`;
    }
  }
  h+=`</div>`;
  document.getElementById("panel").innerHTML=h;
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(t){
  tab=t; updateTabs(); renderPanel();
  if(!res[t]||res[t].error) doFetch(false);
  else doFetch(true);
}
function updateTabs(){
  ["morning","evening"].forEach(t=>{
    const btn=document.getElementById(`tab-${t}`),ac=ROUTES[t].expyColor,a=t===tab;
    btn.style.background=a?"#0f172a":"transparent";
    btn.style.border=a?`1px solid ${ac}44`:"1px solid transparent";
    btn.style.color=a?ac:"#475569";
    const lc=document.getElementById(`lc-${t}`);
    lc.style.background=a?`${ac}22`:"#0f172a"; lc.style.color=a?ac:"#334155";
    lc.textContent=(logs[`${t}Log`]||[]).length;
  });
}

// ─── LOG TOGGLE ───────────────────────────────────────────────────────────────
function toggleLog(){
  const p=document.getElementById("lpanel"),b=document.getElementById("ltbtn");
  if(!p||!b) return;
  const show=p.style.display==="none";
  p.style.display=show?"block":"none";
  b.textContent=(show?"▲":"▼")+` Training log (${(logs[`${tab}Log`]||[]).length} entries)`;
}

// ─── TRAINING MODAL ───────────────────────────────────────────────────────────
function openT(){
  const cfg=ROUTES[tab];
  mform={cp1:"moderate",cp2:"moderate",cp3:"heavy",routeTaken:"expressway"};
  document.getElementById("tsub").textContent=`${cfg.emoji} ${cfg.label}`;
  document.getElementById("tact").value="";
  document.getElementById("tnotes").value="";
  document.getElementById("tsave").style.background=`linear-gradient(135deg,${cfg.expyColor},#0284c7)`;
  let ch="";
  cfg.checkpoints.forEach(cp=>{
    ch+=`<div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">${cp.label}</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;">
        <button onclick="smf('${cp.id}','clear')"    id="mo-${cp.id}-clear"    class="tap-btn" style="padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;background:#1e293b;color:#64748b;border:2px solid #334155;font-family:inherit;">✅ Clear</button>
        <button onclick="smf('${cp.id}','moderate')" id="mo-${cp.id}-moderate" class="tap-btn" style="padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;background:#f59e0b20;color:#f59e0b;border:2px solid #f59e0b;font-family:inherit;">⚠️ Moderate</button>
        <button onclick="smf('${cp.id}','heavy')"    id="mo-${cp.id}-heavy"    class="tap-btn" style="padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;background:#1e293b;color:#64748b;border:2px solid #334155;font-family:inherit;">🔴 Jammed</button>
      </div></div>`;
  });
  document.getElementById("tcp").innerHTML=ch;
  const ac=cfg.expyColor;
  document.getElementById("trt").innerHTML=`
    <button onclick="smf('routeTaken','expressway')" id="mo-rt-expy" class="tap-btn" style="padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;background:${ac}20;color:${ac};border:2px solid ${ac};font-family:inherit;">🛣 Expy</button>
    <button onclick="smf('routeTaken','bijwasan')"   id="mo-rt-bij"  class="tap-btn" style="padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;background:#1e293b;color:#64748b;border:2px solid #334155;font-family:inherit;">🔄 Bijwasan</button>`;
  document.getElementById("tmodal").style.display="flex";
}
function smf(f,v){
  mform[f]=v;
  if(f==="routeTaken"){
    const ac=ROUTES[tab].expyColor;
    [["expy","expressway",ac],["bij","bijwasan","#8b5cf6"]].forEach(([k,val,c])=>{
      const b=document.getElementById(`mo-rt-${k}`);if(!b)return;
      const sel=val===v;
      b.style.background=sel?`${c}20`:"#1e293b";
      b.style.color=sel?c:"#64748b";
      b.style.border=sel?`2px solid ${c}`:"2px solid #334155";
    });
  }else{
    const cols={clear:"#10b981",moderate:"#f59e0b",heavy:"#ef4444"};
    ["clear","moderate","heavy"].forEach(sv=>{
      const b=document.getElementById(`mo-${f}-${sv}`);if(!b)return;
      const sel=sv===v,c=cols[sv];
      b.style.background=sel?`${c}20`:"#1e293b";
      b.style.color=sel?c:"#64748b";
      b.style.border=sel?`2px solid ${c}`:"2px solid #334155";
    });
  }
}
function closeT(){ document.getElementById("tmodal").style.display="none"; }
function saveT(){
  const e={...mform,actualMinutes:document.getElementById("tact").value,notes:document.getElementById("tnotes").value,date:fd(new Date()),time:ft(new Date()),id:Date.now()};
  const k=`${tab}Log`; logs[k]=[...(logs[k]||[]),e];
  save(); updateTabs(); closeT(); renderPanel();
  toast("✅ Logged! AI learns from this next check.");
}

// ─── SETTINGS MODAL ───────────────────────────────────────────────────────────
function openSettings(){
  document.getElementById("key-input").value=getApiKey();
  document.getElementById("key-input").type="password";
  document.getElementById("key-vis-btn").textContent="Show";
  updateKeyStatus();
  document.getElementById("smodal").style.display="flex";
}
function closeSettings(){ document.getElementById("smodal").style.display="none"; }

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg){
  const el=document.createElement("div");
  el.textContent=msg;
  el.style.cssText="position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f1f5f9;padding:10px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:300;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #334155;white-space:nowrap;max-width:90vw;text-overflow:ellipsis;overflow:hidden;";
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),2500);
}

// ─── PWA INSTALL ──────────────────────────────────────────────────────────────
window.addEventListener("beforeinstallprompt", e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  const ts=Number(localStorage.getItem("installDismissedAt")||0);
  const cooldown=3*24*60*60*1000;
  if(!ts||(Date.now()-ts)>cooldown){
    document.getElementById("install-prompt").style.display="block";
  }
});
function installApp(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(()=>{
    deferredInstallPrompt=null;
    document.getElementById("install-prompt").style.display="none";
  });
}
function dismissInstall(){
  localStorage.setItem("installDismissedAt",String(Date.now()));
  document.getElementById("install-prompt").style.display="none";
}
window.addEventListener("appinstalled",()=>{
  document.getElementById("install-prompt").style.display="none";
  toast("🎉 Commute Watch installed!");
});

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
load(); updateTabs(); renderPanel();
fetchWeather();
if(!getApiKey()){
  setTimeout(()=>openSettings(), 350);
}else{
  doFetch(false);
}
