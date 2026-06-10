import { useState, useEffect, useMemo, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#F0F2F5", surface: "#FFFFFF", border: "#DDE1E7",
  primary: "#1A4B8C", primaryLight: "#E8EEF8", primaryDark: "#103366",
  accent: "#E8A020", accentLight: "#FEF3DC",
  danger: "#C0392B", dangerLight: "#FDECEA",
  success: "#1A7A4A", successLight: "#E6F4ED",
  warn: "#C07000", warnLight: "#FFF8E6",
  text: "#1A1F2B", muted: "#6B7380", white: "#FFFFFF",
  chart: ["#1A4B8C","#E8A020","#1A7A4A","#C0392B","#6B7380","#5B3DA8"],
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const DAYS_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MONTH_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const TIPOS_DIA = ["Día laboral","Sábado","Domingo","Feriado"];

const getDayName  = s => { if (!s) return ""; const [y,m,d]=s.split("-").map(Number); return DAYS_ES[new Date(y,m-1,d).getDay()]; };
const fmtDate     = s => { if (!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const monthLabel  = s => { if (!s) return ""; const [y,m]=s.split("-"); return `${y}-${m}`; };
const uid         = () => Math.random().toString(36).slice(2,10);
const todayStr    = () => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; };
const currentYear = () => new Date().getFullYear();

// Sugiere el tipo de día según la fecha (feriado se ajusta manual)
const suggestTipoDia = s => {
  if (!s) return "Día laboral";
  const [y,m,d]=s.split("-").map(Number);
  const dow=new Date(y,m-1,d).getDay();
  if (dow===6) return "Sábado";
  if (dow===0) return "Domingo";
  return "Día laboral";
};
const esFinDeOFeriado = (tipoDia) => tipoDia==="Sábado" || tipoDia==="Domingo" || tipoDia==="Feriado";

// Bono feria: Feria=Sí y (sábado, domingo o feriado) => 1
const calcBono = (tipoDia, feria) => (feria && esFinDeOFeriado(tipoDia)) ? 1 : 0;

// Horas a partir de hora desde/hasta (HH:MM). Soporta cruce de medianoche.
const calcHorasFromTime = (desde, hasta) => {
  if (!desde || !hasta) return 0;
  const [h1,m1]=desde.split(":").map(Number);
  const [h2,m2]=hasta.split(":").map(Number);
  if ([h1,m1,h2,m2].some(isNaN)) return 0;
  let mins=(h2*60+m2)-(h1*60+m1);
  if (mins<0) mins+=24*60;
  return Math.round((mins/60)*100)/100;
};

// Filtra registros según el rol: supervisor ve todo, merchand solo lo suyo.
const visibleFor = (records, user) =>
  (user && user.role==="supervisor") ? records : records.filter(r=>r.merchand===user.name);

// Lista de merchandisers visible según rol (merchand = solo él).
const merchandsFor = (config, user) =>
  (user && user.role==="supervisor") ? config.merchandisers : [user.name];

function downloadCSV(content, filename) {
  const blob = new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8;"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA LAYER (pluggable: localStorage | sheets)
// ─────────────────────────────────────────────────────────────────────────────
// Toda lectura/escritura pasa por este objeto.
//  - "localStorage": guarda en el navegador (prototipo, default).
//  - "sheets": lee/escribe en una Google Sheet vía Apps Script Web App.
// Para activar Sheets: publicá el Apps Script (ver instrucciones), pegá la URL
// en SHEETS_URL y cambiá BACKEND a "sheets". Nada más cambia en la app.
//
const APP_VERSION = "1.0.0";
const BACKEND = "sheets";                // conectado a Google Sheets (Apps Script Web App)
const SHEETS_URL = "https://script.google.com/macros/s/AKfycbx0YPDl8wZQn7kZEjiuiloRwwg6qF1FvSqDKhAh643VyMO2Myl1KSLDf9WuzoHCfQ8y/exec";

const LS = {
  RECORDS:"merchand_v3_records",
  CONFIG: "merchand_v3_config",
  USER:   "merchand_v3_user",
};

// — Backend localStorage (prototipo) —
const localBackend = {
  async getAll() {
    let records=null, config=null;
    try { const s=localStorage.getItem(LS.RECORDS); records=s?JSON.parse(s):null; } catch {}
    try { const s=localStorage.getItem(LS.CONFIG);  config =s?JSON.parse(s):null; } catch {}
    return { records, config };
  },
  async setRecords(records){ try{ localStorage.setItem(LS.RECORDS,JSON.stringify(records)); }catch{} },
  async setConfig(config){   try{ localStorage.setItem(LS.CONFIG, JSON.stringify(config));  }catch{} },
  // En localStorage la app guarda el array completo vía setRecords, así que
  // estas operaciones por-registro son no-ops (devuelven lo recibido).
  async createRecord(rec){ return rec; },
  async updateRecord(rec){ return rec; },
  async setEstado(){ return true; },
  async bulkSetEstado(){ return true; },
  async deleteRecord(){ return true; },
};

// — Backend Google Sheets (Apps Script Web App) —
const sheetsBackend = {
  async getAll() {
    const r = await fetch(SHEETS_URL + "?action=list");
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Error al leer Sheets");
    return { records: data.records || [], config: data.config || null };
  },
  async setRecords(){ /* no-op: en Sheets se escribe registro por registro */ },
  async setConfig(){  /* la config se edita directo en la hoja Config */ },
  async _post(payload) {
    // text/plain evita el preflight CORS que Apps Script no maneja bien
    const r = await fetch(SHEETS_URL, {
      method:"POST",
      headers:{ "Content-Type":"text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Error al escribir en Sheets");
    return data;
  },
  async createRecord(rec){ const d=await this._post({action:"create",record:rec}); return d.record; },
  async updateRecord(rec){ const d=await this._post({action:"update",record:rec}); return d.record; },
  async setEstado(id,estado,aprobadoPor,obs){ await this._post({action:"setEstado",id,estado,aprobadoPor,obs}); return true; },
  async bulkSetEstado(ids,estado,aprobadoPor){ await this._post({action:"bulkSetEstado",ids,estado,aprobadoPor}); return true; },
  async deleteRecord(id){ await this._post({action:"delete",id}); return true; },
};

const backends = { localStorage: localBackend, sheets: sheetsBackend };

const dataLayer = {
  backend: BACKEND,
  isRemote: BACKEND !== "localStorage",
  impl: backends[BACKEND] || localBackend,

  async loadAll()             { return this.impl.getAll(); },
  async setRecords(records)   { return this.impl.setRecords(records); },
  async setConfig(config)     { return this.impl.setConfig(config); },
  async createRecord(rec)     { return this.impl.createRecord(rec); },
  async updateRecord(rec)     { return this.impl.updateRecord(rec); },
  async setEstado(id,e,a,o)   { return this.impl.setEstado(id,e,a,o); },
  async bulkSetEstado(ids,e,a){ return this.impl.bulkSetEstado(ids,e,a); },
  async deleteRecord(id)      { return this.impl.deleteRecord(id); },

  // El usuario (login de prueba) siempre se guarda local, no va a Sheets.
  getUser(){ try{ const s=localStorage.getItem(LS.USER); return s?JSON.parse(s):null; }catch{ return null; } },
  setUser(u){ try{ if(u) localStorage.setItem(LS.USER,JSON.stringify(u)); else localStorage.removeItem(LS.USER); }catch{} },
};



// ─────────────────────────────────────────────────────────────────────────────
// USERS (simple login, no real auth)
// ─────────────────────────────────────────────────────────────────────────────
const USERS = [
  { id:"sup",  name:"Supervisor",  role:"supervisor", pin:"1234" },
  { id:"alen", name:"Alen",        role:"merchand",   pin:"1111" },
  { id:"joaq", name:"Joaquín",     role:"merchand",   pin:"2222" },
  { id:"maur", name:"Mauricio",    role:"merchand",   pin:"3333" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE DATA
// ─────────────────────────────────────────────────────────────────────────────
const SAMPLE = [
  { id:uid(), fecha:"2026-05-03", dia:"Sábado",    tipoDia:"Sábado",      merchand:"Alen",     cliente:"Ferretería Del Valle",  zona:"Montevideo",     tarea:"Feria",                horaDesde:"08:00", horaHasta:"14:00", horas:6, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-05-10", dia:"Domingo",   tipoDia:"Domingo",     merchand:"Alen",     cliente:"HomePro Norte",         zona:"Canelones",      tarea:"Feria",                horaDesde:"09:00", horaHasta:"14:00", horas:5, feria:true,  bonoFeria:1, estado:"Pendiente", aprobadoPor:"", obs:"" },
  { id:uid(), fecha:"2026-05-14", dia:"Miércoles", tipoDia:"Día laboral", merchand:"Joaquín",  cliente:"Construmax",            zona:"Montevideo",     tarea:"Visita especial",      horaDesde:"18:00", horaHasta:"21:00", horas:3, feria:false, bonoFeria:0, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-05-21", dia:"Jueves",    tipoDia:"Día laboral", merchand:"Joaquín",  cliente:"ToolCenter Express",    zona:"Montevideo",     tarea:"Apoyo comercial",      horaDesde:"17:00", horaHasta:"21:00", horas:4, feria:false, bonoFeria:0, estado:"Observado", aprobadoPor:"", obs:"Revisar horas declaradas" },
  { id:uid(), fecha:"2026-05-04", dia:"Domingo",   tipoDia:"Domingo",     merchand:"Mauricio", cliente:"Ferretería Del Valle",  zona:"Montevideo",     tarea:"Desarme de exhibidor", horaDesde:"08:00", horaHasta:"13:00", horas:5, feria:false, bonoFeria:0, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-05-18", dia:"Lunes",     tipoDia:"Día laboral", merchand:"Mauricio", cliente:"Construmax",            zona:"Montevideo",     tarea:"Armado de exhibidor",  horaDesde:"18:00", horaHasta:"22:00", horas:4, feria:false, bonoFeria:0, estado:"Pendiente", aprobadoPor:"", obs:"" },
  { id:uid(), fecha:"2026-04-05", dia:"Domingo",   tipoDia:"Domingo",     merchand:"Alen",     cliente:"HomePro Sur",           zona:"Maldonado",      tarea:"Feria",                horaDesde:"08:00", horaHasta:"16:00", horas:8, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-04-12", dia:"Domingo",   tipoDia:"Domingo",     merchand:"Joaquín",  cliente:"Ferretería Del Valle",  zona:"Montevideo",     tarea:"Reposición",           horaDesde:"09:00", horaHasta:"12:00", horas:3, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-03-07", dia:"Sábado",    tipoDia:"Sábado",      merchand:"Mauricio", cliente:"ToolCenter Express",    zona:"Canelones",      tarea:"Evento",               horaDesde:"08:00", horaHasta:"15:00", horas:7, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-02-14", dia:"Sábado",    tipoDia:"Sábado",      merchand:"Alen",     cliente:"MegaTools",             zona:"Maldonado",      tarea:"Feria",                horaDesde:"08:00", horaHasta:"17:00", horas:9, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
  { id:uid(), fecha:"2026-01-10", dia:"Sábado",    tipoDia:"Sábado",      merchand:"Joaquín",  cliente:"ToolCenter Express",    zona:"Montevideo",     tarea:"Feria",                horaDesde:"09:00", horaHasta:"15:00", horas:6, feria:true,  bonoFeria:1, estado:"Validado",  aprobadoPor:"Supervisor", obs:"" },
];

// Garantiza que todo registro tenga los campos nuevos (compatibilidad hacia atrás)
function normalizeRecord(r) {
  const tipoDia = r.tipoDia || suggestTipoDia(r.fecha);
  return {
    horaDesde:"", horaHasta:"", zona:"", ...r,
    tipoDia,
    dia: r.dia || getDayName(r.fecha),
    bonoFeria: typeof r.bonoFeria==="number" ? r.bonoFeria : calcBono(tipoDia, !!r.feria),
  };
}

const DEFAULT_CONFIG = {
  merchandisers: ["Alen","Joaquín","Mauricio"],
  estados: ["Pendiente","Validado","Observado"],
  tareas: ["Feria","Armado de exhibidor","Desarme de exhibidor","Reposición","Visita especial","Evento","Apoyo comercial","Traslado / logística","Otro"],
};

// ─────────────────────────────────────────────────────────────────────────────
// UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
function Btn({ onClick, children, variant="primary", small, full, disabled, style={} }) {
  const V = {
    primary:   { background:C.primary,   color:C.white,   border:"none" },
    secondary: { background:C.surface,   color:C.primary, border:`1.5px solid ${C.primary}` },
    danger:    { background:C.danger,    color:C.white,   border:"none" },
    ghost:     { background:"transparent", color:C.muted, border:`1.5px solid ${C.border}` },
    accent:    { background:C.accent,    color:C.white,   border:"none" },
    success:   { background:C.success,   color:C.white,   border:"none" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...V[variant], borderRadius:8,
      padding: small?"6px 12px":"13px 18px",
      fontSize: small?13:15, fontWeight:600,
      cursor: disabled?"not-allowed":"pointer",
      opacity: disabled?0.5:1,
      width: full?"100%":undefined,
      display:"inline-flex", alignItems:"center", gap:6,
      letterSpacing:"0.01em", ...style,
    }}>{children}</button>
  );
}

function Badge({ estado }) {
  const map = { Pendiente:{bg:C.warnLight,color:C.warn}, Validado:{bg:C.successLight,color:C.success}, Observado:{bg:C.dangerLight,color:C.danger} };
  const s = map[estado]||{bg:C.bg,color:C.muted};
  return <span style={{background:s.bg,color:s.color,borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{estado}</span>;
}

function Card({ children, style={}, alert }) {
  return (
    <div style={{
      background:C.surface, borderRadius:12,
      border:`1.5px solid ${alert?C.danger:C.border}`,
      padding:14, ...style,
    }}>{children}</div>
  );
}

const Label = ({ children, required }) => (
  <label style={{fontSize:13,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>
    {children}{required&&<span style={{color:C.danger}}> *</span>}
  </label>
);

function Input({ value, onChange, type="text", placeholder, min, step, style={}, onKeyDown }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      min={min} step={step} onKeyDown={onKeyDown}
      style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"11px 12px",
        fontSize:15,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box",...style}} />
  );
}

function Sel({ value, onChange, children, style={} }) {
  return (
    <select value={value} onChange={onChange}
      style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"11px 12px",
        fontSize:15,color:value?"":C.muted,background:C.surface,outline:"none",
        boxSizing:"border-box",appearance:"auto",...style}}>
      {children}
    </select>
  );
}

const FG = ({ label, required, children }) => (
  <div style={{marginBottom:13}}>
    <Label required={required}>{label}</Label>
    {children}
  </div>
);

const SecTitle = ({ children }) => (
  <div style={{fontSize:11,fontWeight:700,color:C.primary,letterSpacing:"0.1em",
    textTransform:"uppercase",marginBottom:10,marginTop:2,
    borderBottom:`2px solid ${C.primaryLight}`,paddingBottom:5}}>{children}</div>
);

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"}}>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
      <div style={{fontSize:26,fontWeight:800,color:color||C.primary,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:C.muted,marginTop:3}}>{sub}</div>}
    </div>
  );
}

function BackBtn({ onBack, label="Volver" }) {
  return (
    <button onClick={onBack} style={{background:"none",border:"none",color:"rgba(255,255,255,.8)",
      fontWeight:700,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",
      gap:4,padding:0,marginBottom:12}}>
      ← {label}
    </button>
  );
}

// Alert banner
function AlertBanner({ msg, color=C.danger, bg=C.dangerLight }) {
  return (
    <div style={{background:bg,border:`1.5px solid ${color}`,borderRadius:8,
      padding:"10px 14px",fontSize:13,fontWeight:700,color,display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
      ⚠ {msg}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE BAR CHART (no library, pure SVG)
// ─────────────────────────────────────────────────────────────────────────────
function BarChart({ data, color=C.primary, height=120, label="" }) {
  // data: [{label, value}]
  if (!data.length) return null;
  const max = Math.max(...data.map(d=>d.value), 1);
  const W = 300; const H = height; const BAR_W = Math.max(14, Math.floor((W - 20) / data.length) - 4);
  const gap = Math.floor((W - 20) / data.length);
  return (
    <div style={{overflowX:"auto",marginBottom:4}}>
      <svg width={Math.max(W, data.length*40)} height={H+30} style={{display:"block"}}>
        {data.map((d,i) => {
          const barH = d.value ? Math.max(4, Math.round((d.value/max)*(H-20))) : 2;
          const x = 10 + i*gap + (gap-BAR_W)/2;
          const y = H - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={BAR_W} height={barH} rx={4}
                fill={Array.isArray(color)?color[i%color.length]:color} opacity={d.value?1:0.2}/>
              {d.value>0&&<text x={x+BAR_W/2} y={y-4} textAnchor="middle" fontSize={10} fill={C.muted} fontWeight="700">{d.value}</text>}
              <text x={x+BAR_W/2} y={H+16} textAnchor="middle" fontSize={9} fill={C.muted}>{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  function tryLogin() {
    if (!selected) { setErr("Seleccioná tu usuario."); return; }
    if (selected.pin !== pin) { setErr("PIN incorrecto."); setPin(""); return; }
    onLogin(selected);
  }

  return (
    <div style={{minHeight:"100vh",background:C.primary,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:360}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:36,marginBottom:8}}>🧰</div>
          <div style={{fontSize:22,fontWeight:800,color:C.white,marginBottom:4}}>Horas Extra Merchand</div>
          <div style={{fontSize:14,color:"rgba(255,255,255,.6)"}}>Ingresá con tu usuario</div>
        </div>

        <Card style={{padding:20}}>
          <FG label="¿Quién sos?">
            <div style={{display:"grid",gap:8}}>
              {USERS.map(u => (
                <button key={u.id} onClick={() => { setSelected(u); setPin(""); setErr(""); }}
                  style={{
                    padding:"13px 16px", borderRadius:10, cursor:"pointer", textAlign:"left",
                    fontWeight:700, fontSize:15,
                    background: selected?.id===u.id ? C.primary : C.bg,
                    color: selected?.id===u.id ? C.white : C.text,
                    border: `2px solid ${selected?.id===u.id ? C.primary : C.border}`,
                    display:"flex", alignItems:"center", gap:10,
                  }}>
                  <span style={{fontSize:20}}>{u.role==="supervisor"?"👔":"👷"}</span>
                  <div>
                    <div>{u.name}</div>
                    <div style={{fontSize:11,fontWeight:400,opacity:.7}}>{u.role==="supervisor"?"Supervisor":"Merchandiser"}</div>
                  </div>
                </button>
              ))}
            </div>
          </FG>

          {selected && (
            <FG label="PIN">
              <Input type="password" value={pin} onChange={e=>setPin(e.target.value)}
                placeholder="••••" onKeyDown={e=>e.key==="Enter"&&tryLogin()} />
            </FG>
          )}

          {err && <div style={{color:C.danger,fontSize:13,fontWeight:600,marginBottom:10}}>⚠ {err}</div>}

          <div style={{fontSize:11,color:C.muted,marginBottom:12,background:C.bg,borderRadius:6,padding:"8px 10px"}}>
            <strong>PINs de prueba:</strong> Supervisor: 1234 · Alen: 1111 · Joaquín: 2222 · Mauricio: 3333
          </div>

          <Btn full onClick={tryLogin} disabled={!selected}>Entrar</Btn>
        </Card>
        <div style={{textAlign:"center",marginTop:14,fontSize:11,color:"rgba(255,255,255,.4)"}}>
          Versión {APP_VERSION}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
function Home({ onNav, records, user, onLogout, onRefresh, loading, syncError, backend }) {
  const myRecords = user.role==="merchand" ? records.filter(r=>r.merchand===user.name) : records;
  const pending   = myRecords.filter(r=>r.estado==="Pendiente").length;
  const observed  = myRecords.filter(r=>r.estado==="Observado").length;
  const isSup     = user.role==="supervisor";

  const menuItems = [
    { label:"＋  Nueva carga",      screen:"form",      primary:true  },
    ...(isSup ? [{ label:"✅  Pendientes de validación", screen:"pending", badge: pending }] : []),
    { label:"📋  Ver registros",    screen:"records"                  },
    { label:"📊  Resumen mensual",  screen:"monthly"                  },
    { label:"📅  Resumen anual",    screen:"annual"                   },
    { label:"📈  Dashboard",        screen:"dashboard"                },
    ...(isSup ? [{ label:"⚙️  Configuración", screen:"config" }] : []),
  ];

  return (
    <div style={{paddingBottom:32}}>
      <div style={{background:`linear-gradient(135deg,${C.primaryDark} 0%,${C.primary} 100%)`,
        padding:"28px 20px 20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.55)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>
              {user.role==="supervisor"?"Supervisor":"Merchandiser"}
            </div>
            <div style={{fontSize:22,fontWeight:800,color:C.white,lineHeight:1.2}}>
              {user.name === "Supervisor" ? "Panel General" : `Hola, ${user.name}`}
            </div>
          </div>
          <button onClick={onLogout} style={{background:"rgba(255,255,255,.15)",border:"none",
            borderRadius:8,padding:"6px 12px",color:C.white,fontSize:13,fontWeight:600,cursor:"pointer"}}>
            Salir
          </button>
        </div>

        {/* Botón actualizar datos + estado de conexión */}
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:10}}>
          <button onClick={onRefresh} disabled={loading} style={{
            background:C.white,border:"none",borderRadius:8,padding:"9px 14px",
            color:C.primary,fontSize:14,fontWeight:700,cursor:loading?"default":"pointer",
            display:"inline-flex",alignItems:"center",gap:7,opacity:loading?0.7:1}}>
            <span style={{display:"inline-block",transition:"transform .6s",
              transform:loading?"rotate(360deg)":"none"}}>🔄</span>
            {loading?"Actualizando...":"Actualizar datos"}
          </button>
          <span style={{fontSize:11,color:"rgba(255,255,255,.55)"}}>
            {backend==="sheets"?"Base compartida":"Modo local"}
          </span>
        </div>

        <div style={{marginTop:12,display:"flex",gap:8,flexWrap:"wrap"}}>
          {pending>0&&(
            <div style={{background:C.accent,borderRadius:8,padding:"5px 12px",
              display:"inline-flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:13,fontWeight:700,color:C.white}}>⏳ {pending} pendiente{pending>1?"s":""}</span>
            </div>
          )}
          {observed>0&&(
            <div style={{background:C.danger,borderRadius:8,padding:"5px 12px",
              display:"inline-flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:13,fontWeight:700,color:C.white}}>⚠ {observed} observado{observed>1?"s":""}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{padding:"16px 16px 0",display:"grid",gap:10}}>
        {syncError&&<AlertBanner msg={syncError} />}
        {observed>0&&(
          <AlertBanner
            msg={`Tenés ${observed} registro${observed>1?"s":""} observado${observed>1?"s":""}. Revisalos para corregirlos.`}
          />
        )}
        {menuItems.map(({label,screen,primary,badge})=>(
          <button key={screen} onClick={()=>onNav(screen)} style={{
            background: primary?C.primary:C.surface,
            color: primary?C.white:C.text,
            border: primary?"none":`1.5px solid ${C.border}`,
            borderRadius:12, padding:"17px 20px", fontSize:17,
            fontWeight: primary?800:600, textAlign:"left", cursor:"pointer",
            boxShadow: primary?"0 4px 14px rgba(26,75,140,.22)":"none",
            display:"flex", justifyContent:"space-between", alignItems:"center",
          }}>
            <span>{label}</span>
            {badge>0&&<span style={{background:C.accent,color:C.white,borderRadius:20,
              minWidth:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",
              fontSize:13,fontWeight:800,padding:"0 7px"}}>{badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM (optimised for speed – today pre-filled, merchand pre-filled if role=merchand)
// ─────────────────────────────────────────────────────────────────────────────
function FormScreen({ onBack, onSave, config, editRecord, user }) {
  const isMerchand = user.role==="merchand";
  const isSup = user.role==="supervisor";
  const blank = {
    fecha: todayStr(),
    merchand: isMerchand ? user.name : "",
    cliente:"", zona:"", tarea:"",
    horaDesde:"", horaHasta:"", horas:"", manualHoras:false,
    tipoDia: suggestTipoDia(todayStr()), tipoDiaManual:false,
    feria:false, obs:""
  };
  const init = editRecord
    ? { fecha:editRecord.fecha, merchand:editRecord.merchand, cliente:editRecord.cliente,
        zona:editRecord.zona||"", tarea:editRecord.tarea,
        horaDesde:editRecord.horaDesde||"", horaHasta:editRecord.horaHasta||"",
        horas:editRecord.horas, manualHoras:false,
        tipoDia:editRecord.tipoDia||suggestTipoDia(editRecord.fecha), tipoDiaManual:true,
        feria:editRecord.feria, obs:editRecord.obs }
    : blank;

  const [f,setF] = useState(init);
  const [errors,setErrors] = useState({});
  const [saved,setSaved] = useState(false);

  const dia  = getDayName(f.fecha);
  const bono = calcBono(f.tipoDia, f.feria);
  // Horas calculadas desde el horario
  const horasCalc = calcHorasFromTime(f.horaDesde, f.horaHasta);
  // El merchand no puede editar horas manualmente; el supervisor sí (toggle).
  const horasEditable = isSup && f.manualHoras;
  const horasFinales = horasEditable ? f.horas : (horasCalc || f.horas);

  const set = (k,v) => setF(p=>({...p,[k]:v}));

  // Al cambiar fecha, re-sugerir tipo de día salvo que se haya tocado manualmente
  function setFecha(v) {
    setF(p=>({ ...p, fecha:v, tipoDia: p.tipoDiaManual ? p.tipoDia : suggestTipoDia(v) }));
  }
  function setTipoDia(v) { setF(p=>({ ...p, tipoDia:v, tipoDiaManual:true })); }

  function validate() {
    const e={};
    if(!f.fecha)          e.fecha="Requerido";
    if(!f.merchand)       e.merchand="Requerido";
    if(!f.cliente.trim()) e.cliente="Requerido";
    if(!f.tarea)          e.tarea="Requerido";
    const h = Number(horasFinales);
    if(!h || isNaN(h) || h<=0) e.horas="Ingresá horario o un número válido";
    setErrors(e);
    return !Object.keys(e).length;
  }

  function handleSave() {
    if(!validate()) return;
    onSave({
      id: editRecord?editRecord.id:uid(),
      fecha:f.fecha, dia, tipoDia:f.tipoDia,
      merchand:f.merchand, cliente:f.cliente.trim(), zona:f.zona.trim(),
      tarea:f.tarea,
      horaDesde:f.horaDesde, horaHasta:f.horaHasta,
      horas:Number(horasFinales),
      feria:f.feria, bonoFeria:bono,
      // Si el merchand corrige un Observado, vuelve a Pendiente
      estado: editRecord ? (editRecord.estado==="Observado" && isMerchand ? "Pendiente" : editRecord.estado) : "Pendiente",
      aprobadoPor: editRecord?editRecord.aprobadoPor:"",
      obs:f.obs.trim(),
    });
    setSaved(true);
  }

  const E = k => errors[k]?<div style={{fontSize:12,color:C.danger,marginTop:3}}>{errors[k]}</div>:null;
  const reSuggest = editRecord && editRecord.estado==="Observado" && isMerchand;

  if(saved) return (
    <div style={{minHeight:"60vh",display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",padding:32,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:12}}>✅</div>
      <div style={{fontSize:20,fontWeight:800,marginBottom:6}}>{editRecord?"Cambios guardados":"Registro guardado"}</div>
      <div style={{color:C.muted,marginBottom:24,fontSize:14}}>
        {reSuggest ? "El registro volvió a estado Pendiente para revisión." : "Las horas fueron cargadas correctamente."}
      </div>
      {!editRecord && <Btn onClick={()=>{ setSaved(false); setF(blank); }}>Cargar otro</Btn>}
      <div style={{marginTop:10}}><Btn variant="ghost" onClick={onBack}>Volver al menú</Btn></div>
    </div>
  );

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack} label={editRecord?"Cancelar edición":"Cancelar"} />
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>
          {editRecord?"Editar registro":"Nueva carga"}
        </div>
      </div>

      <div style={{padding:"16px 16px 0"}}>

        {reSuggest&&<AlertBanner color={C.warn} bg={C.warnLight}
          msg="Corregí los datos observados. Al guardar, el registro vuelve a Pendiente." />}

        {/* Fecha + Merchand */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:13}}>
          <div>
            <Label required>Fecha</Label>
            <Input type="date" value={f.fecha} onChange={e=>setFecha(e.target.value)} />
            {E("fecha")}
            {dia&&<div style={{fontSize:11,color:C.muted,marginTop:3}}>📅 {dia}</div>}
          </div>
          <div>
            <Label required>Merchandiser</Label>
            {isMerchand
              ? <div style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:"11px 12px",
                  fontSize:15,background:C.bg,color:C.text,fontWeight:600}}>{f.merchand}</div>
              : <Sel value={f.merchand} onChange={e=>set("merchand",e.target.value)}>
                  <option value="">Seleccioná...</option>
                  {config.merchandisers.map(m=><option key={m}>{m}</option>)}
                </Sel>
            }
            {E("merchand")}
          </div>
        </div>

        {/* Tipo de día */}
        <FG label="Tipo de día (sugerido automáticamente)">
          <Sel value={f.tipoDia} onChange={e=>setTipoDia(e.target.value)}>
            {TIPOS_DIA.map(t=><option key={t}>{t}</option>)}
          </Sel>
          {!f.tipoDiaManual&&<div style={{fontSize:11,color:C.muted,marginTop:3}}>Sugerido según la fecha. Podés ajustarlo.</div>}
        </FG>

        {/* Cliente + Zona */}
        <FG label="Cliente / Punto de venta" required>
          <Input value={f.cliente} onChange={e=>set("cliente",e.target.value)}
            placeholder="Ej: Ferretería Del Valle" />
          {E("cliente")}
        </FG>
        <FG label="Zona / Localidad">
          <Input value={f.zona} onChange={e=>set("zona",e.target.value)}
            placeholder="Ej: Montevideo, Canelones, Maldonado..." />
        </FG>

        {/* Tarea */}
        <FG label="Tarea / Motivo" required>
          <Sel value={f.tarea} onChange={e=>set("tarea",e.target.value)}>
            <option value="">Seleccioná...</option>
            {config.tareas.map(t=><option key={t}>{t}</option>)}
          </Sel>
          {E("tarea")}
        </FG>

        {/* Horario */}
        <SecTitle>Horario</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <Label>Hora desde</Label>
            <Input type="time" value={f.horaDesde} onChange={e=>set("horaDesde",e.target.value)} />
          </div>
          <div>
            <Label>Hora hasta</Label>
            <Input type="time" value={f.horaHasta} onChange={e=>set("horaHasta",e.target.value)} />
          </div>
        </div>

        {/* Horas calculadas */}
        <div style={{background:C.primaryLight,border:`1px solid ${C.border}`,borderRadius:8,
          padding:"10px 12px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Horas extra</div>
            <div style={{fontSize:22,fontWeight:800,color:C.primary}}>
              {horasEditable ? (f.horas||0) : (horasCalc || f.horas || 0)}h
            </div>
          </div>
          {isSup && (
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,color:C.muted,cursor:"pointer"}}>
              <input type="checkbox" checked={f.manualHoras}
                onChange={e=>set("manualHoras",e.target.checked)} />
              Editar manual
            </label>
          )}
        </div>
        {horasEditable && (
          <FG label="Horas (manual)">
            <Input type="number" value={f.horas} onChange={e=>set("horas",e.target.value)}
              placeholder="3.5" min="0" step="0.5" />
          </FG>
        )}
        {!isSup && <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Las horas se calculan automáticamente desde el horario.</div>}
        {E("horas")}

        {/* Feria */}
        <FG label="¿Es feria?">
          <div style={{display:"flex",gap:8}}>
            {[true,false].map(v=>(
              <button key={String(v)} onClick={()=>set("feria",v)} style={{
                flex:1, padding:"12px", borderRadius:8, fontWeight:700, fontSize:15, cursor:"pointer",
                background: f.feria===v?(v?C.primary:C.bg):C.surface,
                color: f.feria===v?(v?C.white:C.text):C.muted,
                border:`2px solid ${f.feria===v?(v?C.primary:C.border):C.border}`,
              }}>{v?"🎪 Sí":"No"}</button>
            ))}
          </div>
        </FG>

        {/* Bono calculado */}
        <div style={{background: bono?C.accentLight:C.bg,
          border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",marginBottom:13,fontSize:13}}>
          <span style={{fontWeight:700}}>Bono feria: </span>
          <span style={{color:bono?C.accent:C.muted,fontWeight:800}}>{bono}</span>
          {f.feria&&!bono&&<span style={{color:C.muted}}> — aplica en sáb, dom o feriado</span>}
        </div>

        {/* Obs */}
        <FG label="Observaciones">
          <textarea value={f.obs} onChange={e=>set("obs",e.target.value)}
            placeholder="Opcional..." rows={2}
            style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:8,
              padding:"10px 12px",fontSize:15,boxSizing:"border-box",resize:"vertical"}} />
        </FG>

        <Btn full onClick={handleSave} style={{marginTop:4}}>
          {editRecord?"Guardar cambios":"Guardar registro ✓"}
        </Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORDS
// ─────────────────────────────────────────────────────────────────────────────
function RecordsScreen({ onBack, records, setRecords, config, onEdit, user, initialQuick, onRefresh, loading }) {
  const isSup = user.role==="supervisor";
  const base  = isSup ? records : records.filter(r=>r.merchand===user.name);

  const [search,   setSearch]   = useState("");
  const [filterM,  setFilterM]  = useState("Todos");
  const [filterE,  setFilterE]  = useState("Todos");
  const [filterMes,setFilterMes]= useState("Todos");
  const [filterF,  setFilterF]  = useState("Todos");
  const [quick,    setQuick]    = useState(initialQuick||"");
  const [editingId,setEditingId]= useState(null);
  const [editAp,   setEditAp]   = useState("");
  const [editObs,  setEditObs]  = useState("");
  const [editEst,  setEditEst]  = useState("");
  const importRef = useRef();

  const months = useMemo(()=>{
    const s=new Set(base.map(r=>monthLabel(r.fecha)));
    return Array.from(s).sort().reverse();
  },[base]);

  // Filtros rápidos
  const now=new Date();
  const thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const prevD=new Date(now.getFullYear(),now.getMonth()-1,1);
  const prevMonth=`${prevD.getFullYear()}-${String(prevD.getMonth()+1).padStart(2,"0")}`;

  function passQuick(r) {
    switch(quick) {
      case "esteMes":    return monthLabel(r.fecha)===thisMonth;
      case "mesAnterior":return monthLabel(r.fecha)===prevMonth;
      case "pendientes": return r.estado==="Pendiente";
      case "observados": return r.estado==="Observado";
      case "ferias":     return r.feria;
      case "finde":      return r.tipoDia==="Sábado"||r.tipoDia==="Domingo"||r.tipoDia==="Feriado";
      default: return true;
    }
  }

  const filtered = base.filter(r=>{
    if(!passQuick(r)) return false;
    if(filterM!=="Todos"&&r.merchand!==filterM) return false;
    if(filterE!=="Todos"&&r.estado!==filterE)   return false;
    if(filterMes!=="Todos"&&monthLabel(r.fecha)!==filterMes) return false;
    if(filterF==="true"&&!r.feria)  return false;
    if(filterF==="false"&&r.feria)  return false;
    if(search&&!(r.cliente.toLowerCase().includes(search.toLowerCase())||(r.zona||"").toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  }).sort((a,b)=>b.fecha.localeCompare(a.fecha));

  const QUICK_FILTERS=[
    {id:"esteMes",label:"Este mes"},
    {id:"mesAnterior",label:"Mes anterior"},
    {id:"pendientes",label:"Pendientes"},
    {id:"observados",label:"Observados"},
    {id:"ferias",label:"Solo ferias"},
    {id:"finde",label:"Fines de semana"},
  ];

  const observedCount = filtered.filter(r=>r.estado==="Observado").length;

  function update(id,changes) { setRecords(prev=>prev.map(r=>r.id===id?{...r,...changes}:r)); }
  function del(id) { if(confirm("¿Eliminar este registro?")) setRecords(prev=>prev.filter(r=>r.id!==id)); }

  function startEdit(r) {
    setEditingId(r.id); setEditAp(r.aprobadoPor||"");
    setEditObs(r.obs||""); setEditEst(r.estado);
  }
  function saveInline(id) {
    update(id,{estado:editEst,aprobadoPor:editAp,obs:editObs});
    setEditingId(null);
  }

  // CSV export (filtered)
  function exportCSV() {
    const headers=["Fecha","Día","Tipo de día","Merchandiser","Cliente","Zona","Tarea","Hora desde","Hora hasta","Horas","Feria","Bono Feria","Estado","Aprobado por","Observaciones"];
    const rows=filtered.map(r=>[r.fecha,r.dia,r.tipoDia||"",r.merchand,r.cliente,r.zona||"",r.tarea,r.horaDesde||"",r.horaHasta||"",r.horas,r.feria?"Sí":"No",r.bonoFeria,r.estado,r.aprobadoPor,r.obs].join(";"));
    const suffix = (filterMes!=="Todos" ? "_"+filterMes : "") + (filterM!=="Todos" ? "_"+filterM : "") + (quick?"_"+quick:"");
    downloadCSV([headers.join(";"),...rows].join("\n"), "registros"+suffix+".csv");
  }

  // CSV import
  function handleImport(e) {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const lines=ev.target.result.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
      if(!lines.length) return;
      const header=lines[0].split(/[;,]/);
      const idxOf=name=>header.findIndex(h=>h.toLowerCase().includes(name.toLowerCase()));
      const iF=idxOf("fecha"),iTd=idxOf("tipo"),iM=idxOf("merchand"),iCl=idxOf("cliente"),
            iZ=idxOf("zona"),iTa=idxOf("tarea"),iHd=idxOf("desde"),iHh=idxOf("hasta"),
            iH=idxOf("hora"),iFe=idxOf("feria"),iE=idxOf("estado"),iAp=idxOf("aprobado"),iO=idxOf("obs");
      const imported=[];
      for(let i=1;i<lines.length;i++){
        const cols=lines[i].split(/[;,]/);
        if(!cols[iF]||!cols[iM]) continue;
        const fecha=cols[iF]?.trim()||"";
        const feria=(cols[iFe]||"").toLowerCase()==="sí"||(cols[iFe]||"").toLowerCase()==="si"||cols[iFe]==="true";
        const tipoDia=(iTd>=0&&cols[iTd]?.trim())||suggestTipoDia(fecha);
        const horaDesde=iHd>=0?(cols[iHd]?.trim()||""):"";
        const horaHasta=iHh>=0?(cols[iHh]?.trim()||""):"";
        const horasCol=parseFloat(cols[iH]);
        const horas = !isNaN(horasCol)&&horasCol>0 ? horasCol : calcHorasFromTime(horaDesde,horaHasta);
        imported.push(normalizeRecord({
          id:uid(), fecha, dia:getDayName(fecha), tipoDia,
          merchand:cols[iM]?.trim()||"",
          cliente:cols[iCl]?.trim()||"",
          zona:iZ>=0?(cols[iZ]?.trim()||""):"",
          tarea:cols[iTa]?.trim()||"",
          horaDesde, horaHasta, horas:horas||0,
          feria, bonoFeria:calcBono(tipoDia,feria),
          estado:cols[iE]?.trim()||"Pendiente",
          aprobadoPor:cols[iAp]?.trim()||"",
          obs:cols[iO]?.trim()||"",
        }));
      }
      if(imported.length){
        setRecords(prev=>[...imported,...prev]);
        alert("✅ "+imported.length+" registro(s) importado(s) correctamente.");
      } else {
        alert("No se encontraron registros válidos en el CSV.");
      }
      e.target.value="";
    };
    reader.readAsText(file,"utf-8");
  }

  // Merchand: edita propios SÓLO si Pendiente u Observado. Nunca Validado.
  function canEdit(r) {
    if(isSup) return true;
    return r.merchand===user.name && (r.estado==="Pendiente"||r.estado==="Observado");
  }

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack} />
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>Registros</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginTop:2}}>
          {filtered.length} registro{filtered.length!==1?"s":""} · {filtered.reduce((s,r)=>s+r.horas,0)}h total
        </div>
      </div>

      <div style={{padding:"14px 14px 0"}}>
        {observedCount>0&&<AlertBanner msg={observedCount+" registro"+(observedCount>1?"s":"")+" observado"+(observedCount>1?"s":"")+" en esta vista"} />}

        {/* Filtros rápidos */}
        <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:8,marginBottom:8}}>
          {QUICK_FILTERS.map(q=>(
            <button key={q.id} onClick={()=>setQuick(quick===q.id?"":q.id)} style={{
              whiteSpace:"nowrap",borderRadius:20,padding:"7px 14px",fontSize:13,fontWeight:700,cursor:"pointer",
              background: quick===q.id?C.primary:C.surface,
              color: quick===q.id?C.white:C.muted,
              border:`1.5px solid ${quick===q.id?C.primary:C.border}`,
            }}>{q.label}</button>
          ))}
        </div>

        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar cliente o zona..." style={{marginBottom:8}} />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {isSup&&<Sel value={filterM} onChange={e=>setFilterM(e.target.value)}>
            <option value="Todos">Todos los merch.</option>
            {config.merchandisers.map(m=><option key={m}>{m}</option>)}
          </Sel>}
          <Sel value={filterE} onChange={e=>setFilterE(e.target.value)}>
            <option value="Todos">Todos los estados</option>
            {config.estados.map(e=><option key={e}>{e}</option>)}
          </Sel>
          <Sel value={filterMes} onChange={e=>setFilterMes(e.target.value)}>
            <option value="Todos">Todos los meses</option>
            {months.map(m=><option key={m}>{m}</option>)}
          </Sel>
          <Sel value={filterF} onChange={e=>setFilterF(e.target.value)}>
            <option value="Todos">Feria: todos</option>
            <option value="true">Feria: Sí</option>
            <option value="false">Feria: No</option>
          </Sel>
        </div>

        {/* actions row */}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          <Btn small variant="ghost" onClick={onRefresh} disabled={loading}>{loading?"🔄 Actualizando...":"🔄 Actualizar"}</Btn>
          <Btn small variant="secondary" onClick={exportCSV}>⬇ CSV filtrado</Btn>
          {isSup&&(
            <>
              <Btn small variant="ghost" onClick={()=>importRef.current.click()}>⬆ Importar CSV</Btn>
              <input ref={importRef} type="file" accept=".csv" style={{display:"none"}} onChange={handleImport} />
            </>
          )}
        </div>

        {filtered.length===0&&(
          <div style={{textAlign:"center",color:C.muted,padding:"40px 0",fontSize:15}}>
            No hay registros con esos filtros.
          </div>
        )}

        {filtered.map(r=>(
          <Card key={r.id} style={{marginBottom:10}} alert={r.estado==="Observado"}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:C.text}}>{r.merchand}</div>
                <div style={{fontSize:13,color:C.muted}}>{fmtDate(r.fecha)} · {r.dia}</div>
              </div>
              <Badge estado={r.estado} />
            </div>
            <div style={{fontSize:14,color:C.text,fontWeight:700,marginBottom:2}}>{r.cliente}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:8}}>
              {r.tarea}{r.zona?" · 📍 "+r.zona:""}
              {r.tipoDia&&r.tipoDia!=="Día laboral"?" · "+r.tipoDia:""}
            </div>
            <div style={{display:"flex",gap:8,fontSize:13,flexWrap:"wrap"}}>
              <span style={{background:C.primaryLight,color:C.primary,borderRadius:6,padding:"3px 8px",fontWeight:700}}>⏱ {r.horas}h</span>
              {(r.horaDesde&&r.horaHasta)&&<span style={{background:C.bg,color:C.muted,borderRadius:6,padding:"3px 8px",fontWeight:600}}>{r.horaDesde}–{r.horaHasta}</span>}
              {r.feria&&<span style={{background:C.accentLight,color:C.accent,borderRadius:6,padding:"3px 8px",fontWeight:700}}>🎪 Feria</span>}
              {r.bonoFeria>0&&<span style={{background:C.accentLight,color:C.accent,borderRadius:6,padding:"3px 8px",fontWeight:700}}>★ Bono</span>}
            </div>
            {r.aprobadoPor&&<div style={{fontSize:12,color:C.success,marginTop:6}}>✓ Aprobado por {r.aprobadoPor}</div>}
            {r.obs&&<div style={{fontSize:12,color:C.warn,marginTop:4,background:C.warnLight,borderRadius:6,padding:"4px 8px"}}>⚠ {r.obs}</div>}

            {editingId===r.id?(
              <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                <div style={{marginBottom:8}}>
                  <Label>Estado</Label>
                  <Sel value={editEst} onChange={e=>setEditEst(e.target.value)}>
                    {config.estados.map(e=><option key={e}>{e}</option>)}
                  </Sel>
                </div>
                {isSup&&<div style={{marginBottom:8}}>
                  <Label>Aprobado por</Label>
                  <Input value={editAp} onChange={e=>setEditAp(e.target.value)} placeholder="Nombre..." />
                </div>}
                <div style={{marginBottom:10}}>
                  <Label>Observación</Label>
                  <Input value={editObs} onChange={e=>setEditObs(e.target.value)} placeholder="..." />
                </div>
                <div style={{display:"flex",gap:8}}>
                  <Btn small onClick={()=>saveInline(r.id)}>Guardar</Btn>
                  <Btn small variant="ghost" onClick={()=>setEditingId(null)}>Cancelar</Btn>
                </div>
              </div>
            ):(
              canEdit(r)&&(
                <div style={{display:"flex",gap:8,marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:8,flexWrap:"wrap"}}>
                  {isSup&&<Btn small variant="secondary" onClick={()=>startEdit(r)}>Validar / Estado</Btn>}
                  <Btn small variant="ghost" onClick={()=>onEdit(r)}>Editar</Btn>
                  {isSup&&<Btn small variant="danger" onClick={()=>del(r.id)}>Eliminar</Btn>}
                </div>
              )
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY
// ─────────────────────────────────────────────────────────────────────────────
function MonthlyScreen({ onBack, records, config, user }) {
  const visibleRecords = visibleFor(records, user);
  const myMerchands = merchandsFor(config, user);
  const isMerchand = user.role==="merchand";

  const now = new Date();
  const defMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const months = useMemo(()=>{
    const s=new Set(visibleRecords.map(r=>monthLabel(r.fecha)));
    const arr=Array.from(s).sort().reverse();
    if(!arr.includes(defMonth)) arr.unshift(defMonth);
    return arr;
  },[visibleRecords]);

  const [mes,setMes]=useState(months[0]||defMonth);
  const mr=visibleRecords.filter(r=>monthLabel(r.fecha)===mes);

  const tot={
    horas:mr.reduce((s,r)=>s+r.horas,0),
    bono:mr.reduce((s,r)=>s+r.bonoFeria,0),
    pend:mr.filter(r=>r.estado==="Pendiente").length,
    val:mr.filter(r=>r.estado==="Validado").length,
    obs:mr.filter(r=>r.estado==="Observado").length,
  };

  function ctrl(rows){
    if(!rows.length) return {label:"Sin registros",color:C.muted};
    if(rows.some(r=>r.estado==="Observado")) return {label:"Revisar ⚠",color:C.danger};
    if(rows.some(r=>r.estado==="Pendiente")) return {label:"Pte. validación",color:C.warn};
    return {label:"OK ✓",color:C.success};
  }

  // Chart data: horas por día del mes
  const chartData = useMemo(()=>{
    const by={};
    mr.forEach(r=>{ by[r.fecha]=(by[r.fecha]||0)+r.horas; });
    return Object.entries(by).sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([d,v])=>({label:d.slice(8),value:v}));
  },[mr]);

  function exportCSV(){
    const headers=["Merchandiser","Horas","Bonos","Registros","Pendientes","Validados","Observados","Control"];
    const rows=myMerchands.map(m=>{
      const rows2=mr.filter(r=>r.merchand===m);
      const c=ctrl(rows2);
      return [m,rows2.reduce((s,r)=>s+r.horas,0),rows2.reduce((s,r)=>s+r.bonoFeria,0),rows2.length,
        rows2.filter(r=>r.estado==="Pendiente").length,rows2.filter(r=>r.estado==="Validado").length,
        rows2.filter(r=>r.estado==="Observado").length,c.label].join(";");
    });
    downloadCSV([headers.join(";"),...rows].join("\n"),"resumen_mensual_"+mes+".csv");
  }

  // Exportación para LIQUIDACIÓN: solo registros VALIDADOS, resumido por merchand
  function exportLiquidacion(){
    const headers=["Merchandiser","Mes","Total horas extra validadas","Total bonos feria validados","Cantidad registros validados","Observaciones"];
    const rows=myMerchands.map(m=>{
      const val=mr.filter(r=>r.merchand===m && r.estado==="Validado");
      const obsList=mr.filter(r=>r.merchand===m && r.obs).map(r=>r.obs);
      const obsTxt=(obsList.join(" | ")||"").replace(/;/g,",");
      return [m,mes,val.reduce((s,r)=>s+r.horas,0),val.reduce((s,r)=>s+r.bonoFeria,0),val.length,obsTxt].join(";");
    }).filter(Boolean);
    // Total general solo para supervisor (el merchand ya ve solo lo suyo)
    if(!isMerchand){
      const allVal=mr.filter(r=>r.estado==="Validado");
      rows.push(["TOTAL",mes,allVal.reduce((s,r)=>s+r.horas,0),allVal.reduce((s,r)=>s+r.bonoFeria,0),allVal.length,""].join(";"));
    }
    downloadCSV([headers.join(";"),...rows].join("\n"),"liquidacion_"+mes+".csv");
  }

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack} />
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>{isMerchand ? "Mi resumen mensual" : "Resumen mensual"}</div>
      </div>
      <div style={{padding:"14px 14px 0"}}>
        <FG label="Mes">
          <Sel value={mes} onChange={e=>setMes(e.target.value)}>
            {months.map(m=><option key={m}>{m}</option>)}
          </Sel>
        </FG>

        {tot.obs>0&&<AlertBanner msg={`${tot.obs} registro${tot.obs>1?"s":""} observado${tot.obs>1?"s":""} este mes`}/>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <StatCard label="Horas extra" value={tot.horas}/>
          <StatCard label="Bonos feria" value={tot.bono} color={C.accent}/>
          <StatCard label="Pendientes" value={tot.pend} color={C.warn}/>
          <StatCard label="Validados" value={tot.val} color={C.success}/>
          <StatCard label="Observados" value={tot.obs} color={C.danger}/>
          <StatCard label="Total registros" value={mr.length}/>
        </div>

        {chartData.length>0&&(
          <Card style={{marginBottom:16}}>
            <SecTitle>Horas extra por día</SecTitle>
            <BarChart data={chartData} color={C.primary} height={100}/>
          </Card>
        )}

        <SecTitle>{isMerchand?"Tu resumen":"Por merchandiser"}</SecTitle>
        {myMerchands.map(m=>{
          const rows=mr.filter(r=>r.merchand===m);
          const c=ctrl(rows);
          const horas=rows.reduce((s,r)=>s+r.horas,0);
          const bono=rows.reduce((s,r)=>s+r.bonoFeria,0);
          const obsT=rows.filter(r=>r.obs).map(r=>r.obs).join("; ");
          return (
            <Card key={m} style={{marginBottom:10}} alert={rows.some(r=>r.estado==="Observado")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontWeight:800,fontSize:15}}>{m}</span>
                <span style={{background:c.color===C.success?C.successLight:c.color===C.danger?C.dangerLight:c.color===C.warn?C.warnLight:C.bg,
                  color:c.color,fontWeight:700,fontSize:12,borderRadius:20,padding:"3px 10px"}}>{c.label}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,fontSize:12}}>
                {[["Horas",horas],["Bonos",bono],["Registros",rows.length],
                  ["Pend.",rows.filter(r=>r.estado==="Pendiente").length],
                  ["Val.",rows.filter(r=>r.estado==="Validado").length],
                  ["Obs.",rows.filter(r=>r.estado==="Observado").length]
                ].map(([l,v])=>(
                  <div key={l} style={{background:C.bg,borderRadius:6,padding:"7px",textAlign:"center"}}>
                    <div style={{fontSize:10,color:C.muted,fontWeight:600}}>{l}</div>
                    <div style={{fontSize:17,fontWeight:800,color:C.text}}>{v}</div>
                  </div>
                ))}
              </div>
              {obsT&&<div style={{fontSize:12,color:C.warn,marginTop:8,background:C.warnLight,borderRadius:6,padding:"5px 8px"}}>⚠ {obsT}</div>}
            </Card>
          );
        })}
        <Btn variant="secondary" full onClick={exportCSV}>⬇ Exportar CSV mensual</Btn>
        {!isMerchand && (
          <>
            <div style={{height:10}}/>
            <Btn variant="accent" full onClick={exportLiquidacion}>💰 Exportar liquidación mensual</Btn>
            <div style={{fontSize:11,color:C.muted,marginTop:6,textAlign:"center"}}>
              La liquidación incluye solo registros validados, resumidos por merchandiser.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNUAL
// ─────────────────────────────────────────────────────────────────────────────
function AnnualScreen({ onBack, records, config, user }) {
  const visibleRecords = visibleFor(records, user);
  const myMerchands = merchandsFor(config, user);
  const isMerchand = user.role==="merchand";

  const years = useMemo(()=>{
    const s=new Set(visibleRecords.map(r=>r.fecha.slice(0,4)));
    const arr=Array.from(s).sort().reverse();
    const cy=String(currentYear());
    if(!arr.includes(cy)) arr.unshift(cy);
    return arr;
  },[visibleRecords]);

  const [year,setYear]=useState(years[0]||String(currentYear()));
  const yr=parseInt(year);

  const sum=(m,idx,field)=>visibleRecords.filter(r=>r.merchand===m&&r.fecha.slice(0,4)===year&&parseInt(r.fecha.slice(5,7))===idx+1).reduce((s,r)=>s+r[field],0);
  const sumM=(idx,field)=>visibleRecords.filter(r=>r.fecha.slice(0,4)===year&&parseInt(r.fecha.slice(5,7))===idx+1).reduce((s,r)=>s+r[field],0);
  const sumTotal=(m,field)=>visibleRecords.filter(r=>r.merchand===m&&r.fecha.slice(0,4)===year).reduce((s,r)=>s+r[field],0);

  function exportCSV(){
    const lines=[];
    ["horas","bonoFeria"].forEach(field=>{
      lines.push(field==="horas"?"HORAS EXTRA":"BONOS FERIA");
      lines.push(["Merchandiser",...MONTH_SHORT,"Total"].join(";"));
      myMerchands.forEach(m=>{
        lines.push([m,...MONTH_SHORT.map((_,i)=>sum(m,i,field)),sumTotal(m,field)].join(";"));
      });
      if(!isMerchand){
        lines.push(["Total",...MONTH_SHORT.map((_,i)=>sumM(i,field)),visibleRecords.filter(r=>r.fecha.slice(0,4)===year).reduce((s,r)=>s+r[field],0)].join(";"));
      }
      lines.push("");
    });
    downloadCSV(lines.join("\n"),`resumen_anual_${year}.csv`);
  }

  function AnnualTable({ field, label }) {
    const monthChart=MONTH_SHORT.map((_,i)=>({label:MONTH_SHORT[i],value:sumM(i,field)}));
    return (
      <div style={{marginBottom:24}}>
        <SecTitle>{label}</SecTitle>
        <Card style={{marginBottom:12}}>
          <BarChart data={monthChart} color={field==="horas"?C.primary:C.accent} height={90}/>
        </Card>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr style={{background:C.primary}}>
                <th style={{color:C.white,padding:"7px 8px",textAlign:"left",fontWeight:700}}>Merch.</th>
                {MONTH_SHORT.map(m=><th key={m} style={{color:C.white,padding:"7px 4px",textAlign:"center",fontWeight:700}}>{m}</th>)}
                <th style={{color:C.accent,padding:"7px 8px",textAlign:"center",fontWeight:800}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {myMerchands.map((m,idx)=>{
                const total=sumTotal(m,field);
                return (
                  <tr key={m} style={{background:idx%2===0?C.surface:C.bg}}>
                    <td style={{padding:"7px 8px",fontWeight:700,color:C.text,whiteSpace:"nowrap"}}>{m}</td>
                    {MONTH_SHORT.map((_,i)=>{
                      const v=sum(m,i,field);
                      return <td key={i} style={{padding:"7px 4px",textAlign:"center",color:v?C.text:C.border,fontWeight:v?700:400}}>{v||"–"}</td>;
                    })}
                    <td style={{padding:"7px 8px",textAlign:"center",fontWeight:800,color:C.primary,background:C.primaryLight}}>{total||"–"}</td>
                  </tr>
                );
              })}
              {!isMerchand&&(
                <tr style={{background:C.primary}}>
                  <td style={{padding:"7px 8px",fontWeight:800,color:C.white}}>Total</td>
                  {MONTH_SHORT.map((_,i)=>{
                    const v=sumM(i,field);
                    return <td key={i} style={{padding:"7px 4px",textAlign:"center",color:C.white,fontWeight:700}}>{v||"–"}</td>;
                  })}
                  <td style={{padding:"7px 8px",textAlign:"center",fontWeight:800,color:C.accent}}>
                    {visibleRecords.filter(r=>r.fecha.slice(0,4)===year).reduce((s,r)=>s+r[field],0)||"–"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack} />
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>{isMerchand ? "Mi resumen anual" : "Resumen anual"}</div>
      </div>
      <div style={{padding:"14px 14px 0"}}>
        <FG label="Año">
          <Sel value={year} onChange={e=>setYear(e.target.value)}>
            {years.map(y=><option key={y}>{y}</option>)}
          </Sel>
        </FG>
        <AnnualTable field="horas" label="Horas extra" />
        <AnnualTable field="bonoFeria" label="Bonos feria" />
        <Btn variant="secondary" full onClick={exportCSV}>⬇ Exportar CSV anual</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function DashboardScreen({ onBack, records, config, user }) {
  const visibleRecords = visibleFor(records, user);
  const myMerchands = merchandsFor(config, user);
  const isMerchand = user.role==="merchand";

  const years=useMemo(()=>{
    const s=new Set(visibleRecords.map(r=>r.fecha.slice(0,4)));
    const arr=Array.from(s).sort().reverse();
    const cy=String(currentYear());
    if(!arr.includes(cy)) arr.unshift(cy);
    return arr;
  },[visibleRecords]);

  const [year,setYear]=useState(years[0]||String(currentYear()));
  const yr=visibleRecords.filter(r=>r.fecha.slice(0,4)===year);

  const totalH=yr.reduce((s,r)=>s+r.horas,0);
  const totalB=yr.reduce((s,r)=>s+r.bonoFeria,0);
  const pend=yr.filter(r=>r.estado==="Pendiente").length;
  const val=yr.filter(r=>r.estado==="Validado").length;
  const obs=yr.filter(r=>r.estado==="Observado").length;

  const mHoras=myMerchands.map(m=>({
    name:m, label:m, horas:yr.filter(r=>r.merchand===m).reduce((s,r)=>s+r.horas,0),
    bono:yr.filter(r=>r.merchand===m).reduce((s,r)=>s+r.bonoFeria,0),
  })).sort((a,b)=>b.horas-a.horas);

  // Monthly horas chart
  const monthChart=MONTH_SHORT.map((lbl,i)=>({
    label:lbl,
    value:yr.filter(r=>parseInt(r.fecha.slice(5,7))===i+1).reduce((s,r)=>s+r.horas,0)
  }));

  // Monthly bono chart (para merchand: sus bonos por mes; para supervisor: por merchand)
  const bonoMonthChart=MONTH_SHORT.map((lbl,i)=>({
    label:lbl,
    value:yr.filter(r=>parseInt(r.fecha.slice(5,7))===i+1).reduce((s,r)=>s+r.bonoFeria,0)
  }));
  const bonoByMerchandChart=myMerchands.map(m=>({
    label:m.split(" ")[0],
    value:yr.filter(r=>r.merchand===m).reduce((s,r)=>s+r.bonoFeria,0)
  }));

  const topMonth=monthChart.reduce((a,b)=>b.value>a.value?b:a,{label:"–",value:0});

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack}/>
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>{isMerchand?"Mi dashboard":"Dashboard"}</div>
      </div>
      <div style={{padding:"14px 14px 0"}}>
        <FG label="Año">
          <Sel value={year} onChange={e=>setYear(e.target.value)}>
            {years.map(y=><option key={y}>{y}</option>)}
          </Sel>
        </FG>

        {obs>0&&<AlertBanner msg={`${obs} registro${obs>1?"s":""} observado${obs>1?"s":""} en ${year}`}/>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <StatCard label={isMerchand?"Mis horas extra":"Horas extra"} value={totalH}/>
          <StatCard label={isMerchand?"Mis bonos feria":"Bonos feria"} value={totalB} color={C.accent}/>
          <StatCard label="Pendientes" value={pend} color={C.warn}/>
          <StatCard label="Validados" value={val} color={C.success}/>
          <StatCard label="Observados" value={obs} color={C.danger}/>
          <StatCard label="Total registros" value={yr.length}/>
        </div>

        {/* Monthly horas chart */}
        <Card style={{marginBottom:16}}>
          <SecTitle>{isMerchand?"Mis horas extra por mes":"Horas extra por mes"} — {year}</SecTitle>
          <BarChart data={monthChart} color={C.primary} height={110}/>
          {topMonth.value>0&&(
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>
              📍 Mes pico: <strong>{topMonth.label}</strong> ({topMonth.value}h)
            </div>
          )}
        </Card>

        {isMerchand ? (
          /* Merchand: gráfico mensual de SUS bonos, sin comparativa */
          <Card style={{marginBottom:16}}>
            <SecTitle>Mis bonos feria por mes — {year}</SecTitle>
            <BarChart data={bonoMonthChart} color={C.accent} height={90}/>
          </Card>
        ) : (
          <>
            {/* Supervisor: bonos por merchand + ranking comparativo */}
            <Card style={{marginBottom:16}}>
              <SecTitle>Bonos feria por merchandiser — {year}</SecTitle>
              <BarChart data={bonoByMerchandChart} color={C.chart} height={90}/>
            </Card>

            <SecTitle>Ranking de horas extra</SecTitle>
            {mHoras.map((m,i)=>(
              <Card key={m.name} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:28,height:28,borderRadius:"50%",
                      background:i===0?C.accent:C.primaryLight,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:13,fontWeight:800,color:i===0?C.white:C.primary}}>{i+1}</div>
                    <span style={{fontWeight:700,fontSize:15}}>{m.name}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontWeight:800,fontSize:19,color:C.primary}}>{m.horas}h</div>
                    <div style={{fontSize:11,color:C.muted}}>{m.bono} bono{m.bono!==1?"s":""}</div>
                  </div>
                </div>
                <div style={{height:6,background:C.bg,borderRadius:3,marginTop:8}}>
                  <div style={{height:6,background:i===0?C.accent:C.primary,borderRadius:3,
                    width:`${totalH?(m.horas/totalH)*100:0}%`,transition:"width .4s"}}/>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PENDIENTES DE VALIDACIÓN (solo supervisor)
// ─────────────────────────────────────────────────────────────────────────────
function PendingScreen({ onBack, records, setRecords, onRefresh, loading }) {
  const pendientes = records.filter(r=>r.estado==="Pendiente").sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const [sel,setSel] = useState(()=>new Set());
  const [apBy,setApBy] = useState("Supervisor");
  const [obsId,setObsId] = useState(null);   // registro abriendo modal observación
  const [obsText,setObsText] = useState("");

  function toggle(id) {
    setSel(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  }
  function toggleAll() {
    if(sel.size===pendientes.length) setSel(new Set());
    else setSel(new Set(pendientes.map(r=>r.id)));
  }
  function validarSeleccionados() {
    if(!sel.size) return;
    const aprobador = apBy.trim()||"Supervisor";
    setRecords(prev=>prev.map(r=>sel.has(r.id)?{...r,estado:"Validado",aprobadoPor:aprobador}:r));
    setSel(new Set());
  }
  function abrirObservar(id) { setObsId(id); setObsText(""); }
  function confirmarObservar() {
    if(!obsText.trim()) return; // comentario obligatorio
    setRecords(prev=>prev.map(r=>r.id===obsId?{...r,estado:"Observado",obs:obsText.trim(),aprobadoPor:""}:r));
    setObsId(null); setObsText("");
  }

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:19,fontWeight:800,color:C.white}}>Pendientes de validación</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginTop:2}}>
              {pendientes.length} registro{pendientes.length!==1?"s":""} esperando revisión
            </div>
          </div>
          <button onClick={onRefresh} disabled={loading} style={{background:"rgba(255,255,255,.15)",
            border:"none",borderRadius:8,padding:"8px 12px",color:C.white,fontSize:13,fontWeight:700,
            cursor:loading?"default":"pointer"}}>{loading?"🔄":"🔄 Actualizar"}</button>
        </div>
      </div>

      <div style={{padding:"14px 14px 0"}}>
        {pendientes.length===0?(
          <div style={{textAlign:"center",color:C.muted,padding:"50px 0"}}>
            <div style={{fontSize:40,marginBottom:8}}>🎉</div>
            <div style={{fontSize:16,fontWeight:700}}>No hay registros pendientes</div>
            <div style={{fontSize:13,marginTop:4}}>Todo está al día.</div>
          </div>
        ):(
          <>
            {/* barra de acciones masivas */}
            <Card style={{marginBottom:12,position:"sticky",top:0,zIndex:5}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:700,fontSize:14,cursor:"pointer"}}>
                  <input type="checkbox" checked={sel.size===pendientes.length&&pendientes.length>0}
                    onChange={toggleAll} style={{width:18,height:18}}/>
                  Seleccionar todos ({sel.size})
                </label>
              </div>
              <div style={{marginBottom:8}}>
                <Label>Aprobado por</Label>
                <Input value={apBy} onChange={e=>setApBy(e.target.value)} placeholder="Nombre del aprobador" />
              </div>
              <Btn variant="success" full disabled={!sel.size} onClick={validarSeleccionados}>
                ✓ Validar {sel.size>0?"("+sel.size+")":"seleccionados"}
              </Btn>
            </Card>

            {pendientes.map(r=>(
              <Card key={r.id} style={{marginBottom:10,borderColor:sel.has(r.id)?C.primary:C.border}}>
                <div style={{display:"flex",gap:10}}>
                  <input type="checkbox" checked={sel.has(r.id)} onChange={()=>toggle(r.id)}
                    style={{width:20,height:20,marginTop:2,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{r.merchand}</div>
                        <div style={{fontSize:13,color:C.muted}}>{fmtDate(r.fecha)} · {r.dia}</div>
                      </div>
                      <Badge estado={r.estado}/>
                    </div>
                    <div style={{fontSize:14,fontWeight:700,marginTop:4}}>{r.cliente}</div>
                    <div style={{fontSize:13,color:C.muted}}>
                      {r.tarea}{r.zona?" · 📍 "+r.zona:""}{r.tipoDia&&r.tipoDia!=="Día laboral"?" · "+r.tipoDia:""}
                    </div>
                    <div style={{display:"flex",gap:8,fontSize:13,flexWrap:"wrap",marginTop:8}}>
                      <span style={{background:C.primaryLight,color:C.primary,borderRadius:6,padding:"3px 8px",fontWeight:700}}>⏱ {r.horas}h</span>
                      {(r.horaDesde&&r.horaHasta)&&<span style={{background:C.bg,color:C.muted,borderRadius:6,padding:"3px 8px",fontWeight:600}}>{r.horaDesde}–{r.horaHasta}</span>}
                      {r.bonoFeria>0&&<span style={{background:C.accentLight,color:C.accent,borderRadius:6,padding:"3px 8px",fontWeight:700}}>★ Bono</span>}
                    </div>

                    {obsId===r.id?(
                      <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                        <Label required>Comentario de observación</Label>
                        <textarea value={obsText} onChange={e=>setObsText(e.target.value)}
                          rows={2} placeholder="Explicá qué hay que corregir..."
                          style={{width:"100%",border:`1.5px solid ${obsText.trim()?C.border:C.danger}`,
                            borderRadius:8,padding:"10px 12px",fontSize:14,boxSizing:"border-box",resize:"vertical"}}/>
                        {!obsText.trim()&&<div style={{fontSize:12,color:C.danger,marginTop:3}}>El comentario es obligatorio</div>}
                        <div style={{display:"flex",gap:8,marginTop:8}}>
                          <Btn small variant="danger" disabled={!obsText.trim()} onClick={confirmarObservar}>Marcar observado</Btn>
                          <Btn small variant="ghost" onClick={()=>setObsId(null)}>Cancelar</Btn>
                        </div>
                      </div>
                    ):(
                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <Btn small variant="success" onClick={()=>{
                          setRecords(prev=>prev.map(x=>x.id===r.id?{...x,estado:"Validado",aprobadoPor:apBy.trim()||"Supervisor"}:x));
                        }}>✓ Validar</Btn>
                        <Btn small variant="secondary" onClick={()=>abrirObservar(r.id)}>⚠ Observar</Btn>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG (supervisor only)
// ─────────────────────────────────────────────────────────────────────────────
function ConfigScreen({ onBack, config, setConfig }) {
  const [newM,setNewM]=useState("");
  const [newT,setNewT]=useState("");

  const addM=()=>{ const v=newM.trim(); if(v&&!config.merchandisers.includes(v)){ setConfig(c=>({...c,merchandisers:[...c.merchandisers,v]})); setNewM(""); }};
  const delM=m=>setConfig(c=>({...c,merchandisers:c.merchandisers.filter(x=>x!==m)}));
  const addT=()=>{ const v=newT.trim(); if(v&&!config.tareas.includes(v)){ setConfig(c=>({...c,tareas:[...c.tareas,v]})); setNewT(""); }};
  const delT=t=>setConfig(c=>({...c,tareas:c.tareas.filter(x=>x!==t)}));

  const ListItem=({label,onDel})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
      borderRadius:8,marginBottom:7}}>
      <span style={{fontWeight:600,fontSize:14}}>{label}</span>
      <button onClick={onDel} style={{background:C.dangerLight,color:C.danger,border:"none",
        borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:700,fontSize:13}}>✕</button>
    </div>
  );

  return (
    <div style={{paddingBottom:40}}>
      <div style={{background:C.primary,padding:"20px 16px 14px"}}>
        <BackBtn onBack={onBack}/>
        <div style={{fontSize:19,fontWeight:800,color:C.white}}>Configuración</div>
      </div>
      <div style={{padding:"14px 14px 0"}}>
        <SecTitle>Merchandisers</SecTitle>
        {config.merchandisers.map(m=><ListItem key={m} label={m} onDel={()=>delM(m)}/>)}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <Input value={newM} onChange={e=>setNewM(e.target.value)} placeholder="Nuevo merchandiser..." onKeyDown={e=>e.key==="Enter"&&addM()}/>
          <Btn onClick={addM}>+</Btn>
        </div>

        <SecTitle>Tipos de tarea</SecTitle>
        {config.tareas.map(t=><ListItem key={t} label={t} onDel={()=>delT(t)}/>)}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <Input value={newT} onChange={e=>setNewT(e.target.value)} placeholder="Nueva tarea..." onKeyDown={e=>e.key==="Enter"&&addT()}/>
          <Btn onClick={addT}>+</Btn>
        </div>

        <SecTitle>Estados</SecTitle>
        {config.estados.map(e=>(
          <div key={e} style={{padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:8,marginBottom:7,fontWeight:600,fontSize:13,color:C.muted}}>
            {e}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // En remoto arrancamos vacío y cargamos de Sheets; en local, desde localStorage.
  const [records,setRecords]=useState(()=>{
    if (dataLayer.isRemote) return [];
    try { const s=localStorage.getItem(LS.RECORDS); return (s?JSON.parse(s):SAMPLE).map(normalizeRecord); }
    catch { return SAMPLE.map(normalizeRecord); }
  });
  const [config,setConfig]=useState(()=>{
    if (dataLayer.isRemote) return DEFAULT_CONFIG;
    try { const s=localStorage.getItem(LS.CONFIG); return s?JSON.parse(s):DEFAULT_CONFIG; }
    catch { return DEFAULT_CONFIG; }
  });
  const [user,setUser]=useState(()=>dataLayer.getUser());
  const [loading,setLoading]=useState(false);
  const [syncError,setSyncError]=useState("");

  // Carga desde el backend (sirve para el botón "Actualizar datos")
  async function refresh() {
    setLoading(true); setSyncError("");
    try {
      const { records:recs, config:cfg } = await dataLayer.loadAll();
      if (recs) setRecords(recs.map(normalizeRecord));
      else if (!dataLayer.isRemote) setRecords(SAMPLE.map(normalizeRecord));
      if (cfg) setConfig(cfg);
    } catch (e) {
      setSyncError("No se pudieron actualizar los datos. Revisá la conexión.");
    } finally {
      setLoading(false);
    }
  }

  // Carga inicial: en remoto siempre; en local solo si no había nada guardado.
  useEffect(()=>{ if (dataLayer.isRemote) refresh(); /* eslint-disable-next-line */ },[]);

  // Persistencia: en local guarda el array completo; en remoto es no-op
  // (cada cambio ya se escribió registro por registro).
  useEffect(()=>{ dataLayer.setRecords(records); },[records]);
  useEffect(()=>{ dataLayer.setConfig(config); },[config]);
  useEffect(()=>{ dataLayer.setUser(user); },[user]);

  const [screen,setScreen]=useState("home");
  const [editRecord,setEditRecord]=useState(null);
  const [recordsQuick,setRecordsQuick]=useState("");

  function handleLogin(u){ setUser(u); setScreen("home"); if(dataLayer.isRemote) refresh(); }
  function handleLogout(){ setUser(null); setScreen("home"); }

  // Guardado de un registro (nuevo o editado): actualiza UI y backend remoto
  async function handleSave(record){
    const rec=normalizeRecord(record);
    const isEdit=!!editRecord;
    if(isEdit){ setRecords(prev=>prev.map(r=>r.id===rec.id?rec:r)); }
    else { setRecords(prev=>[rec,...prev]); }
    setEditRecord(null);
    setScreen("home");
    if(dataLayer.isRemote){
      try { isEdit ? await dataLayer.updateRecord(rec) : await dataLayer.createRecord(rec); }
      catch { setSyncError("No se pudo guardar en la base compartida."); }
    }
  }

  // setRecords "inteligente": refleja en UI y, en remoto, sincroniza el cambio puntual.
  // Las pantallas siguen llamando setRecords(prev=>...) igual que antes.
  function setRecordsSynced(updater){
    setRecords(prev=>{
      const next = typeof updater==="function" ? updater(prev) : updater;
      if(dataLayer.isRemote) syncDiff(prev, next);
      return next;
    });
  }

  // Detecta qué cambió entre prev y next para enviar la operación correcta a Sheets.
  async function syncDiff(prev, next){
    try{
      const prevById=Object.fromEntries(prev.map(r=>[r.id,r]));
      const nextById=Object.fromEntries(next.map(r=>[r.id,r]));
      // eliminados
      for(const r of prev){ if(!nextById[r.id]) await dataLayer.deleteRecord(r.id); }
      // nuevos o modificados
      for(const r of next){
        const old=prevById[r.id];
        if(!old) await dataLayer.createRecord(r);
        else if(JSON.stringify(old)!==JSON.stringify(r)) await dataLayer.updateRecord(r);
      }
    }catch{ setSyncError("Algunos cambios no se sincronizaron."); }
  }

  function handleEdit(record){ setEditRecord(record); setScreen("form"); }
  function nav(s){ setEditRecord(null); setRecordsQuick(""); setScreen(s); }

  if(!user) return (
    <div style={{maxWidth:480,margin:"0 auto",fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",color:C.text}}>
      <LoginScreen onLogin={handleLogin}/>
    </div>
  );

  return (
    <div style={{maxWidth:480,margin:"0 auto",background:C.bg,minHeight:"100vh",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",color:C.text}}>
      {screen==="home"    && <Home     onNav={nav} records={records} user={user} onLogout={handleLogout}
                                       onRefresh={refresh} loading={loading} syncError={syncError} backend={dataLayer.backend}/>}
      {screen==="form"    && <FormScreen onBack={()=>nav("home")} onSave={handleSave} config={config} editRecord={editRecord} user={user}/>}
      {screen==="pending" && <PendingScreen onBack={()=>nav("home")} records={records} setRecords={setRecordsSynced} onRefresh={refresh} loading={loading}/>}
      {screen==="records" && <RecordsScreen onBack={()=>nav("home")} records={records} setRecords={setRecordsSynced} config={config} onEdit={handleEdit} user={user} initialQuick={recordsQuick} onRefresh={refresh} loading={loading}/>}
      {screen==="monthly" && <MonthlyScreen onBack={()=>nav("home")} records={records} config={config} user={user}/>}
      {screen==="annual"  && <AnnualScreen  onBack={()=>nav("home")} records={records} config={config} user={user}/>}
      {screen==="dashboard"&&<DashboardScreen onBack={()=>nav("home")} records={records} config={config} user={user}/>}
      {screen==="config"  && <ConfigScreen  onBack={()=>nav("home")} config={config} setConfig={setConfig}/>}
    </div>
  );
}
