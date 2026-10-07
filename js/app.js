'use strict';
/* =====================================================================
   app.js — Control Mantenimiento
   Mismo aspecto que Control Gerencia (los estilos son los de Gerencia): en computadora, menú lateral;
   en celular, encabezado con degradado y barra inferior flotante.

   Semáforo de un reporte (lo manda el instructor desde Control Fitness):
     ROJO      estado "nuevo"     nadie lo ha abierto (sin importar si es normal, urgente o no se puede usar)
     AMARILLO  estado "atencion"  mantenimiento lo abrió: pasa solo a "en proceso"
     VERDE     estado "resuelto"  mantenimiento lo resolvió; el instructor lo elimina para quitarlo
   Datos en Firebase Realtime Database (proyecto registro-mantenimiento):
     /salones/{id}     {nombre, area}
     /equipos/{id}     {nombre, salonId, foto}
     /reportes/{id}    reportes ABIERTOS
     /historial/{id}   reportes que el instructor ya eliminó (con cerrado = fecha)
     /preventivo/{id}  {titulo, detalle, salonId, freq, proxima, posp[], hist[]}
   ===================================================================== */
var DAY = 864e5, CACHE_KEY = 'cm_cache_v1';
var URG_TXT = { normal: 'Normal', urgente: 'Urgente', fuera: 'No se puede usar' };
/* Salones tal como se llaman en Control Fitness (el nombre debe coincidir). [id, nombre, área] */
var SALONES_FITNESS = [['salon-1', 'Salón 1', 'Salones'], ['salon-spinning', 'Salon Spinning', 'Spinning'], ['salon-yoga', 'Salon Yoga', 'Yoga'],
  ['salon-2', 'Salon 2', 'Salones'], ['salon-3', 'Salon3', 'Salones'], ['box', 'Box', 'Box'], ['crossfit', 'CrossFit', 'CrossFit']];

var DB = { equipos: {}, salones: {}, reportes: {}, preventivo: {}, historial: {} };
var db = null, online = false, ready = false, fbError = '';

/* ---------- utilidades ---------- */
function sod(t){ var d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function now(){ return Date.now(); }
function arr(x){ return Array.isArray(x) ? x : x ? Object.keys(x).map(function(k){ return x[k]; }) : []; }
function lista(k){ return Object.keys(DB[k] || {}).map(function(id){ return Object.assign({ id: id }, DB[k][id]); }); }
function limpia(o){ var r = {}; Object.keys(o).forEach(function(k){ if (o[k] !== undefined) r[k] = o[k]; }); return r; }
function plu(n, s, p){ return n + ' ' + (n === 1 ? s : p); }
function fechaTxt(ts){ return new Date(ts).toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' }); }
function fechaInput(ts){ var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function hace(ts){
  var m = Math.max(0, Math.round((now() - ts) / 6e4));
  if (m < 60) return 'hace ' + m + ' min';
  var h = Math.round(m / 60);
  if (h < 48) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' días';
}
try { var c0 = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c0) { DB = Object.assign(DB, c0); ready = true; } } catch(e){}
function cacheSave(){ try { localStorage.setItem(CACHE_KEY, JSON.stringify(DB)); } catch(e){} }

/* ---------- iconos (los mismos trazos que usa Control Gerencia) ---------- */
var ICONS = {
  doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  areas:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  dash:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  next:'<path d="M9 5l7 7-7 7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  llave:'<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  img:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-8 8"/>'
};
function ic(n){ return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }
function pill(t, cls){ return '<span class="pill ' + (cls || '') + '">' + esc(t) + '</span>'; }
function kpi(label, value, cap, o){
  o = o || {};
  return '<div class="kpi" style="--kc:' + (o.color || 'var(--g)') + '"><span class="k-l">' + label + '</span><b class="' + (o.cls || '') + '">' + value + '</b>' + (cap ? '<em class="k-c">' + cap + '</em>' : '') + '</div>';
}
function empty(t){ return '<div class="empty">' + t + '</div>'; }

/* ---------- Firebase ---------- */
function initFB(){
  try {
    if (typeof firebase === 'undefined') throw new Error('No se pudo cargar Firebase. Abre la app una vez con internet.');
    firebase.initializeApp(FIREBASE_MANT);
    db = firebase.database();
    db.ref('.info/connected').on('value', function(s){ online = !!s.val(); softRender(); });
    ['equipos', 'salones', 'reportes', 'preventivo'].forEach(function(k){
      db.ref(k).on('value', function(s){ DB[k] = s.val() || {}; ready = true; fbError = ''; cacheSave(); softRender(); },
        function(err){ fbError = 'Firebase: ' + err.message; softRender(); });
    });
    db.ref('historial').limitToLast(200).on('value', function(s){ DB.historial = s.val() || {}; cacheSave(); softRender(); }, function(){});
  } catch (e) { fbError = e.message; }
}
function guarda(ruta, valor){
  if (!db) { toast('Sin conexión con la base de datos'); return Promise.reject(); }
  return db.ref(ruta).set(valor).catch(function(e){ toast('No se pudo guardar: ' + e.message); });
}
function actualiza(ruta, campos){
  if (!db) { toast('Sin conexión con la base de datos'); return Promise.reject(); }
  return db.ref(ruta).update(limpia(campos)).catch(function(e){ toast('No se pudo guardar: ' + e.message); });
}
function nuevoId(ruta){ return db ? db.ref(ruta).push().key : 'x' + Math.random().toString(36).slice(2, 9); }

/* ---------- estado de pantalla ---------- */
var ui = { tab:'reportes', nivel:'todos', areaF:'Todos', sh:null, sheet:null, dirty:false };

/* ---------- datos derivados ---------- */
function eqById(id){ return Object.assign({ id: id, nombre:'Equipo (eliminado)', salonId:'', foto:'' }, (DB.equipos || {})[id] || {}); }
function salonById(id){ return Object.assign({ id: id, nombre:'—', area:'' }, (DB.salones || {})[id] || {}); }
function eqLugar(e){ return salonById(e.salonId).nombre; }
function eqArea(e){ return salonById(e.salonId).area; }
function abiertos(){ return lista('reportes'); }
function esFitness(r){ return r.origen === 'fitness' || (r.origen == null && /^\d+$/.test(String(r.profId == null ? '' : r.profId))); }   // igual que Control Gerencia
function semaforo(r){ return r.estado === 'resuelto' ? 'verde' : r.estado === 'atencion' ? 'amar' : 'rojo'; }
function diasPrev(p){ return Math.round((p.proxima - sod(now())) / DAY); }
function eqEstado(id){
  var rs = abiertos().filter(function(r){ return r.equipoId === id; });
  if (rs.some(function(r){ return r.urg === 'fuera' && r.estado !== 'resuelto'; })) return { t:'Fuera de servicio', c:'bad' };
  if (rs.some(function(r){ return r.estado === 'nuevo'; })) return { t:'Reporte sin atender', c:'bad' };
  if (rs.some(function(r){ return r.estado === 'atencion'; })) return { t:'En proceso', c:'warn' };
  if (rs.length) return { t:'Resuelto, por cerrar', c:'ok' };
  return { t:'Sin pendientes', c:'ok' };
}
function sortRep(a, b){
  var k = function(r){ return r.estado === 'nuevo' ? 0 : r.estado === 'atencion' ? 1 : 2; };
  return k(a) - k(b) || a.creado - b.creado;
}

/* ---------- piezas de pantalla ---------- */
function pillEstado(r){
  return r.estado === 'resuelto' ? pill('Resuelto', 'ok big') : r.estado === 'atencion' ? pill('En proceso', 'warn big') : pill('Sin atender', 'bad big');
}
function pillUrg(r){
  return r.urg === 'fuera' ? pill('No se puede usar', 'u-fuera') : r.urg === 'urgente' ? pill('Urgente', 'u-urg') : pill('Normal', 'mut');
}
function repCard(r, abre){
  var e = eqById(r.equipoId), x = [];
  if (r.otroLugar) x.push('<small><b>Reportado desde otro salón</b></small>');
  if (r.diag) x.push('<small><b>Diagnóstico:</b> ' + esc(r.diag) + '</small>');
  if (r.compra || r.cambio) x.push('<small>' + (r.compra ? 'Requiere compra' : '') + (r.compra && r.cambio ? ' · ' : '') + (r.cambio ? 'Requiere cambio' : '') + (r.costo ? ' · estimado $' + esc(r.costo) : '') + '</small>');
  var inner = '<div class="rep-h">' + pillEstado(r) + pillUrg(r) + (abre ? '<span class="go">' + ic('next') + '</span>' : '') + '</div>' +
    '<b class="rep-t">' + esc(e.nombre) + '</b><span class="rep-d">' + esc(r.desc) + '</span>' +
    '<small>' + esc(eqLugar(e)) + ' · ' + esc(r.prof || 'Instructor') + (r.clase ? ' · ' + esc(r.clase) : '') + ' · ' + hace(r.creado) + '</small>' +
    (x.length ? '<div class="rep-x">' + x.join('') + '</div>' : '');
  return abre ? '<button class="rep ' + semaforo(r) + '" data-a="openRep" data-v="' + r.id + '">' + inner + '</button>'
              : '<div class="rep ' + semaforo(r) + '">' + inner + '</div>';
}
function prevCard(p, ro){
  var d = diasPrev(p), cls = d < 0 ? 'rojo' : d === 0 ? 'amar' : '';
  var cuando = d < 0 ? 'Venció hace ' + (-d) + (d === -1 ? ' día' : ' días') : d === 0 ? 'Toca hoy' : d === 1 ? 'Mañana' : 'Toca el ' + fechaTxt(p.proxima);
  var pp = arr(p.posp), lug = p.salonId ? salonById(p.salonId).nombre : '';
  return '<div class="rep ' + cls + '"><div class="rep-h">' + (d < 0 ? pill('Vencido', 'bad big') : d === 0 ? pill('Toca hoy', 'warn big') : pill('Programado', 'mut big')) + '</div>' +
    '<b class="rep-t">' + esc(p.titulo) + '</b>' + (p.detalle ? '<span class="rep-d">' + esc(p.detalle) + '</span>' : '') +
    '<small>' + (lug ? esc(lug) + ' · ' : '') + cuando + '</small>' +
    (pp.length ? '<small>Pospuesto ' + pp.length + (pp.length === 1 ? ' vez' : ' veces') + ' · último motivo: ' + esc(pp[pp.length - 1].motivo) + '</small>' : '') +
    (ro ? '' : '<div class="btns"><button class="btn primary" data-a="prevDone" data-v="' + p.id + '">Ya se revisó</button><button class="btn" data-a="prevPosp" data-v="' + p.id + '">Posponer</button></div>' +
      '<button class="btn sm" data-a="prevEdit" data-v="' + p.id + '" style="align-self:flex-start;margin-top:8px">Editar</button>') + '</div>';
}

/* ---------- vistas ---------- */
function empiezaAqui(){
  if (lista('salones').length || lista('equipos').length) return '';
  return '<div class="card"><div class="h2 sm" style="margin-top:0">Empieza aquí</div><div class="sub">Todavía no hay salones ni equipos. Primero da de alta los salones, y luego los equipos de cada uno. Así a cada instructor solo le aparecen los equipos de su salón.</div>' +
    '<div class="stack"><button class="btn primary" data-a="salonesFitness">Cargar los salones de Fitness</button><button class="btn" data-a="salones">Dar de alta salones a mano</button><button class="btn" data-a="ejemplo">Cargar catálogo de ejemplo</button></div></div>';
}
function pruebaCard(){
  return '<div class="h2 sm">Datos de prueba</div><div class="card"><div class="sub" style="margin:0 0 10px">Para probar sin esperar. “Cargar reportes de ejemplo” crea cuatro reportes en distintos estados. “Borrar datos de prueba” quita los reportes de ejemplo y los equipos y revisiones del catálogo de ejemplo. No toca los salones, ni los reportes reales de los instructores.</div>' +
    '<div class="btns" style="margin-top:0"><button class="btn" data-a="reportesEjemplo">Cargar reportes de ejemplo</button><button class="btn danger" data-a="borraPrueba">Borrar datos de prueba</button></div></div>';
}
function vReportes(){
  var all = abiertos(), l = all.slice();
  var nSin = all.filter(function(r){ return r.estado === 'nuevo'; }).length, nPro = all.filter(function(r){ return r.estado === 'atencion'; }).length, nRes = all.filter(function(r){ return r.estado === 'resuelto'; }).length;
  if (ui.nivel !== 'todos') l = l.filter(function(r){ return r.urg === ui.nivel; });
  l.sort(sortRep);
  return empiezaAqui() +
    '<div class="kpis k3">' + kpi('Sin atender', nSin, 'nadie los ha abierto', { cls: nSin ? 'bad' : 'ok', color: 'var(--bad)' }) +
      kpi('En proceso', nPro, 'ya los vio mantenimiento', { cls: nPro ? 'warn' : '', color: 'var(--warn)' }) +
      kpi('Resueltos', nRes, 'el instructor los quita', { cls: 'ok', color: 'var(--ok)' }) + '</div>' +
    '<div class="chips">' + [['todos', 'Todos'], ['fuera', 'No se puede usar'], ['urgente', 'Urgente'], ['normal', 'Normal']].map(function(f){
      return '<button class="chip' + (ui.nivel === f[0] ? ' on' : '') + '" data-a="nivel" data-v="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    (l.length ? '<div class="replist">' + l.map(function(r){ return repCard(r, true); }).join('') + '</div>' : empty(ready ? 'No hay reportes en esta lista.' : 'Cargando…')) +
    pruebaCard();
}
function vPreventivo(){
  var l = lista('preventivo').sort(function(a, b){ return a.proxima - b.proxima; });
  var ven = l.filter(function(p){ return diasPrev(p) < 0; }), hoy = l.filter(function(p){ return diasPrev(p) === 0; }), prox = l.filter(function(p){ return diasPrev(p) > 0; });
  var grid = function(x){ return '<div class="replist">' + x.map(function(p){ return prevCard(p); }).join('') + '</div>'; };
  return '<div class="sub">' + esc(fechaTxt(sod(now()))) + '</div><div class="btns" style="margin-top:0;margin-bottom:6px"><button class="btn primary" data-a="prevNew">' + ic('plus') + ' Agregar revisión</button></div>' +
    (!l.length ? empty('Todavía no hay revisiones programadas. Toca “Agregar revisión” para crear la primera, con su frecuencia.') : '') +
    (ven.length ? '<div class="h2 sm"><span class="bad">Vencido · ' + ven.length + '</span></div>' + grid(ven) : '') +
    (l.length ? '<div class="h2 sm">Para hoy · ' + hoy.length + '</div>' + (hoy.length ? grid(hoy) : empty('Nada más para hoy.')) +
      '<div class="h2 sm">Próximos</div>' + (prox.length ? grid(prox) : empty('No hay preventivos próximos.')) : '');
}
function vEquipos(){
  var eqs = lista('equipos').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
  var areas = ['Todos'].concat(eqs.map(function(e){ return eqArea(e); }).filter(function(a, i, ar){ return a && ar.indexOf(a) === i; }));
  var l = eqs.filter(function(e){ return ui.areaF === 'Todos' || eqArea(e) === ui.areaF; });
  return '<div class="btns" style="margin-top:0"><button class="btn primary" data-a="eqNew">' + ic('plus') + ' Agregar equipo</button><button class="btn" data-a="salones">Salones</button></div>' + empiezaAqui() +
    (areas.length > 1 ? '<div class="chips">' + areas.map(function(a){ return '<button class="chip' + (ui.areaF === a ? ' on' : '') + '" data-a="areaF" data-v="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div>' : '') +
    (l.length ? '<div class="eqgrid">' + l.map(function(e){
      var s = eqEstado(e.id);
      return '<button class="eq" data-a="eqOpen" data-v="' + e.id + '"><div class="pic">' + ic('img') + (e.foto ? esc(e.foto) + '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</div>' +
        '<div class="inf"><b>' + esc(e.nombre) + '</b><small>' + esc(eqLugar(e)) + '</small>' + pill(s.t, s.c) + '</div></button>';
    }).join('') + '</div>' : empty('No hay equipos en esta lista.'));
}
/* Reportes gerencia: lo mismo que ve Control Gerencia (solo reportes de instructores de Fitness) */
function vGerencia(){
  var ab = abiertos().filter(esFitness).sort(sortRep), pv = lista('preventivo'), hoy = sod(now());
  var sin = ab.filter(function(r){ return r.estado === 'nuevo'; }), pro = ab.filter(function(r){ return r.estado === 'atencion'; }), res = ab.filter(function(r){ return r.estado === 'resuelto'; });
  var cer = lista('historial').filter(esFitness).filter(function(r){ return (r.cerrado || 0) >= now() - 30 * DAY; }).length;
  var ven = pv.filter(function(p){ return diasPrev(p) < 0; });
  var pospN = pv.reduce(function(n, p){ return n + arr(p.posp).length; }, 0);
  var compras = ab.filter(function(r){ return (r.compra || r.cambio) && r.estado !== 'resuelto'; });
  var total = compras.reduce(function(n, r){ return n + (parseFloat(r.costo) || 0); }, 0);
  return '<div class="vinc"><b>Esto es lo que ve Control Gerencia</b><span>Solo lectura. Por ahora solo cuentan los reportes de instructores de Fitness; los de ejemplo no se incluyen.</span></div>' +
    '<div class="kpis k3">' + kpi('Sin atender', sin.length, sin.length ? 'problemas en rojo' : 'sin problemas', { cls: sin.length ? 'bad' : 'ok', color: 'var(--bad)' }) +
      kpi('En proceso', pro.length, 'ya los vio mantenimiento', { cls: pro.length ? 'warn' : '', color: 'var(--warn)' }) +
      kpi('Atendidos', res.length + cer, res.length + ' por cerrar · ' + cer + ' cerrados en 30 días', { cls: 'ok', color: 'var(--ok)' }) + '</div>' +
    '<div class="kpis k3">' + kpi('Preventivos vencidos', ven.length, ven.length ? 'revisión atrasada' : 'al corriente', { cls: ven.length ? 'bad' : 'ok', color: 'var(--bad)' }) +
      kpi('Pospuestos', pospN, 'veces que se movió una revisión', { color: 'var(--b3)' }) +
      kpi('Compras o cambios', compras.length, total ? 'estimado $' + total.toLocaleString('es-MX') : 'por autorizar', { color: 'var(--b2)' }) + '</div>' +
    '<div class="h2">Sin atender</div>' + (sin.length ? '<div class="replist">' + sin.map(function(r){ return repCard(r, false); }).join('') + '</div>' : empty('No hay reportes en rojo.')) +
    '<div class="h2">En proceso</div>' + (pro.length ? '<div class="replist">' + pro.map(function(r){ return repCard(r, false); }).join('') + '</div>' : empty('No hay reportes en proceso.')) +
    '<div class="h2">Atendidos, por cerrar</div>' + (res.length ? '<div class="replist">' + res.map(function(r){ return repCard(r, false); }).join('') + '</div>' : empty('No hay reportes resueltos esperando cierre.')) +
    '<div class="h2">Preventivos vencidos</div>' + (ven.length ? '<div class="replist">' + ven.map(function(p){ return prevCard(p, true); }).join('') + '</div>' : empty('Todo el preventivo va al corriente.'));
}

/* ---------- hojas (ventana emergente, igual que en Gerencia) ---------- */
function mHead(t){ return '<div class="sh-h"><b>' + esc(t) + '</b><button class="ibtn" data-a="close" aria-label="Cerrar">' + ic('x') + '</button></div>'; }
function opcionesSalon(sel, vacio){
  return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista('salones').map(function(s){ return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.nombre) + ' · ' + esc(s.area) + '</option>'; }).join('');
}
function sheetRep(){
  var raw = DB.reportes[ui.sheet.id]; if (!raw) return '';
  var r = Object.assign({ id: ui.sheet.id }, raw), e = eqById(r.equipoId), sh = ui.sh, hecho = r.estado === 'resuelto';
  return mHead(e.nombre) +
    '<div class="rep ' + semaforo(r) + '" style="margin-bottom:14px"><div class="rep-h">' + pillEstado(r) + pillUrg(r) + '</div>' +
    '<span class="rep-d">' + esc(r.desc) + '</span><small>' + esc(eqLugar(e)) + ' · ' + esc(r.prof || 'Instructor') + (r.area ? ' · ' + esc(r.area) : '') + (r.clase ? ' · ' + esc(r.clase) : '') + ' · ' + hace(r.creado) + '</small>' +
    (r.visto ? '<small>Lo abrió mantenimiento ' + hace(r.visto) + '</small>' : '') + '</div>' +
    '<label class="f"><span>Qué encontraste y qué hiciste</span><textarea data-f="diag"' + (hecho ? ' disabled' : '') + ' placeholder="Describe la anomalía y la atención">' + esc(sh.diag) + '</textarea></label>' +
    '<label class="chk"><input type="checkbox" data-f="compra"' + (sh.compra ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita comprar algo</label>' +
    '<label class="chk"><input type="checkbox" data-f="cambio"' + (sh.cambio ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita cambio de pieza o equipo</label>' +
    '<label class="f" style="margin-top:8px"><span>Costo estimado (opcional)</span><input inputmode="decimal" data-f="costo" value="' + esc(sh.costo) + '" placeholder="0"' + (hecho ? ' disabled' : '') + '></label>' +
    (hecho ? '<div class="sub">Este reporte ya está resuelto. Se quita cuando el instructor lo elimine.</div>' :
      '<div class="btns"><button class="btn" data-a="saveRep">Guardar nota</button><button class="btn primary" data-a="resolveRep">Marcar resuelto</button></div>');
}
function sheetPosp(){
  var p = DB.preventivo[ui.sheet.id]; if (!p) return '';
  var motivos = ['Evento del club', 'Falta refacción', 'Falta personal', 'Otro'];
  return mHead('Posponer') + '<div class="card" style="margin-bottom:12px"><b>' + esc(p.titulo) + '</b><div class="sub" style="margin:2px 0 0">' + esc(p.detalle || '') + '</div></div>' +
    '<div class="lbl" style="font-weight:600;font-size:13px;color:var(--ink-2)">Motivo</div><div class="chips">' + motivos.map(function(m){ return '<button class="chip' + (ui.sh.motivo === m ? ' on' : '') + '" data-a="motivo" data-v="' + m + '">' + m + '</button>'; }).join('') + '</div>' +
    '<label class="f"><span>Nueva fecha</span><input type="date" data-f="fecha" min="' + fechaInput(sod(now()) + DAY) + '" value="' + esc(ui.sh.fecha) + '"></label>' +
    '<button class="btn cta block" data-a="prevPospSave">Guardar nueva fecha</button><div class="sub" style="margin-top:10px">Gerencia ve cuántas veces se pospone un preventivo y por qué.</div>';
}
function sheetEq(){
  var raw = DB.equipos[ui.sheet.id]; if (!raw) return '';
  var e = eqById(ui.sheet.id), s = eqEstado(e.id);
  var h = abiertos().concat(lista('historial')).filter(function(r){ return r.equipoId === e.id; }).sort(function(a, b){ return b.creado - a.creado; });
  return mHead(e.nombre) +
    '<div class="eq" style="margin-bottom:12px"><div class="pic">' + ic('img') + esc(e.foto || '') + (e.foto ? '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
    '<div class="sub" style="margin:0 0 6px">' + esc(eqLugar(e)) + ' · ' + esc(eqArea(e)) + '</div>' + pill(s.t, s.c + ' big') +
    '<div class="btns"><button class="btn" data-a="eqEdit" data-v="' + e.id + '">Editar equipo</button></div>' +
    '<div class="h2 sm">Historial</div>' + (h.length ? '<div class="stack">' + h.map(function(r){
      return '<div class="rep ' + (r.cerrado ? 'verde' : semaforo(r)) + '"><div class="rep-h">' + (r.cerrado ? pill('Cerrado', 'ok big') : pillEstado(r)) + '<span class="go mut" style="font-size:12.5px">' + hace(r.creado) + '</span></div><span class="rep-d">' + esc(r.desc) + '</span>' + (r.diag ? '<small>' + esc(r.diag) + '</small>' : '') + '</div>';
    }).join('') + '</div>' : empty('Este equipo no tiene reportes.'));
}
function sheetEqForm(){
  var nuevo = !ui.sheet.id;
  if (!lista('salones').length) return mHead('Agregar equipo') + empty('Primero da de alta al menos un salón o zona. Toca “Salones” en la pantalla de Equipos.');
  return mHead(nuevo ? 'Agregar equipo' : 'Editar equipo') +
    '<label class="f"><span>Nombre</span><input data-f="nombre" placeholder="Ej. Bicicleta spinning 04" value="' + esc(ui.sh.nombre) + '"></label>' +
    '<label class="f"><span>Salón o zona</span><select data-f="salonId">' + opcionesSalon(ui.sh.salonId) + '</select><small class="mut">El equipo solo le aparece a los instructores cuyas clases se dan en ese salón.</small></label>' +
    '<label class="f"><span>Nombre del archivo de foto</span><input data-f="foto" placeholder="bici-04.jpg" value="' + esc(ui.sh.foto) + '"><small class="mut">La foto se sube al repositorio, carpeta img/equipos, y se llama por este nombre.</small></label>' +
    '<button class="btn cta block" data-a="eqSave">Guardar equipo</button>' + (nuevo ? '' : '<button class="btn danger block" style="margin-top:10px" data-a="eqDel">Eliminar equipo</button>');
}
function sheetSalones(){
  var ss = lista('salones').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
  return mHead('Salones y zonas') +
    '<div class="sub">Cada equipo pertenece a un salón. El nombre debe ser igual al del salón en Control Fitness, para que a cada instructor le salgan los equipos de su salón.</div>' +
    (SALONES_FITNESS.some(function(f){ return !DB.salones[f[0]]; }) ? '<button class="btn primary block" style="margin-bottom:12px" data-a="salonesFitness">Cargar los salones de Fitness</button>' : '') +
    (ss.length ? ss.map(function(s){
      return '<div class="card" style="margin-bottom:10px"><div class="row"><div><b>' + esc(s.nombre) + '</b><small>Área ' + esc(s.area) + '</small></div></div>' +
        '<div class="btns" style="margin-top:10px"><button class="btn sm" data-a="salEdit" data-v="' + s.id + '">Renombrar</button><button class="btn sm danger" data-a="salDel" data-v="' + s.id + '">Eliminar</button></div></div>';
    }).join('') : empty('Todavía no hay salones.')) +
    '<div class="h2 sm">Agregar salón</div>' +
    '<label class="f"><span>Nombre del salón o zona</span><input data-f="nombre" placeholder="Ej. Salon Spinning" value="' + esc(ui.sh.nombre) + '"></label>' +
    '<label class="f"><span>Área</span><input data-f="area" list="areas" placeholder="Ej. Spinning, Gimnasio, Salones" value="' + esc(ui.sh.area) + '"></label>' +
    '<datalist id="areas">' + ss.map(function(s){ return s.area; }).filter(function(a, i, ar){ return a && ar.indexOf(a) === i; }).map(function(a){ return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
    '<button class="btn cta block" data-a="salAdd">Agregar salón</button>';
}
function sheetPrevForm(){
  var nuevo = !ui.sheet.id, fr = [[7, 'Cada semana'], [15, 'Cada 15 días'], [30, 'Cada mes'], [90, 'Cada 3 meses'], [180, 'Cada 6 meses'], [365, 'Cada año']];
  return mHead(nuevo ? 'Agregar revisión' : 'Editar revisión') +
    '<label class="f"><span>Qué se revisa</span><input data-f="titulo" placeholder="Ej. Bicicletas de spinning" value="' + esc(ui.sh.titulo) + '"></label>' +
    '<label class="f"><span>Detalle (opcional)</span><input data-f="detalle" placeholder="Ej. Tornillería, pedales y resistencia" value="' + esc(ui.sh.detalle) + '"></label>' +
    '<label class="f"><span>Dónde</span><select data-f="salonId">' + opcionesSalon(ui.sh.salonId, 'En general') + '</select></label>' +
    '<label class="f"><span>Frecuencia</span><select data-f="freq">' + fr.map(function(f){ return '<option value="' + f[0] + '"' + (+ui.sh.freq === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label>' +
    '<label class="f"><span>Próxima revisión</span><input type="date" data-f="proxima" value="' + esc(ui.sh.proxima) + '"></label>' +
    '<button class="btn cta block" data-a="prevSave">Guardar revisión</button>' + (nuevo ? '' : '<button class="btn danger block" style="margin-top:10px" data-a="prevDel">Eliminar revisión</button>');
}

/* ---------- marco: menú lateral (computadora), encabezado y barra inferior (celular) ---------- */
var NAV = [['reportes', 'Reportes', 'Reportes', 'doc'], ['preventivo', 'Preventivo', 'Preventivo', 'cal'], ['equipos', 'Equipos', 'Equipos', 'areas'], ['gerencia', 'Reportes gerencia', 'Gerencia', 'dash']];
var TITULOS = {
  reportes: ['Reportes', 'Reportes de equipo de los instructores'],
  preventivo: ['Hoy te toca', 'Revisiones programadas'],
  equipos: ['Equipos', 'Catálogo por salón'],
  gerencia: ['Reportes gerencia', 'Lo que ve Control Gerencia · solo lectura']
};
function cloud(){
  return fbError ? { cls:'bad', txt:'Sin conexión con la base' } : online ? { cls:'on', txt:'Conectado' } : { cls:'warn', txt:'Sin internet' };
}
function badgeNav(id){
  var n = id === 'reportes' ? abiertos().filter(function(r){ return r.estado === 'nuevo'; }).length : id === 'preventivo' ? lista('preventivo').filter(function(p){ return diasPrev(p) < 0; }).length : 0;
  return n ? '<span class="pill bad" style="margin-left:auto;padding:1px 8px">' + n + '</span>' : '';
}
function sidebar(){
  var c = cloud();
  return '<aside class="sidebar"><div class="sb-brand"><div class="sb-logo"><span>C</span><img src="img/logo.png" alt="Club Campestre Aguascalientes" data-fallback></div>' +
    '<div><b>Control Mantenimiento</b><small>Club Campestre</small></div></div>' +
    '<nav class="sb-nav">' + NAV.map(function(n){ return '<button class="' + (ui.tab === n[0] ? 'on' : '') + '" data-a="tab" data-v="' + n[0] + '">' + ic(n[3]) + '<span>' + n[1] + '</span>' + badgeNav(n[0]) + '</button>'; }).join('') + '</nav>' +
    '<div class="sb-foot"><div class="sb-user"><b>Mantenimiento</b>Técnico</div><span class="cloud ' + c.cls + '"><i></i>' + c.txt + '</span></div></aside>';
}
function topbar(t){
  var c = cloud();
  return '<header class="topbar"><div class="tb-logo only-m"><span>C</span><img src="img/logo.png" alt="Club Campestre" data-fallback></div>' +
    '<div class="tb-t"><b>' + esc(t[0]) + '</b><small>' + esc(t[1]) + '</small><span class="cloud ' + c.cls + '"><i></i>' + c.txt + '</span></div></header>';
}
function bottomnav(){
  return '<nav class="bottomnav" aria-label="Navegación">' + NAV.map(function(n){
    return '<button class="' + (ui.tab === n[0] ? 'on' : '') + '" data-a="tab" data-v="' + n[0] + '">' + ic(n[3]) + '<span>' + n[2] + '</span></button>';
  }).join('') + '</nav>';
}
function render(){
  ui.dirty = false;
  var t = ui.tab, body = t === 'reportes' ? vReportes() : t === 'preventivo' ? vPreventivo() : t === 'equipos' ? vEquipos() : vGerencia();
  var errBanner = fbError ? '<div class="vinc off"><b>No se pudo conectar con la base de datos</b><span>' + esc(fbError) + '</span></div>'
    : !online ? '<div class="vinc off"><b>Sin internet</b><span>Los cambios se envían al volver la señal. No cierres la app hasta entonces.</span></div>' : '';
  document.getElementById('app').innerHTML = '<div class="app">' + sidebar() + '<div class="content">' + topbar(TITULOS[t]) + '<main class="main">' + errBanner + body + '</main></div>' + bottomnav() + '</div>';
  var m = document.getElementById('modal'), k = ui.sheet && ui.sheet.k, html = '';
  if (k) html = k === 'rep' ? sheetRep() : k === 'posp' ? sheetPosp() : k === 'eq' ? sheetEq() : k === 'eqform' ? sheetEqForm() : k === 'sal' ? sheetSalones() : sheetPrevForm();
  if (html) { m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; m.hidden = false; document.body.style.overflow = 'hidden'; }
  else { m.hidden = true; m.innerHTML = ''; document.body.style.overflow = ''; }
}
function escribiendo(){ var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
function softRender(){ if (escribiendo()) { ui.dirty = true; return; } render(); }
var toastT;
function toast(msg){ var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove('show'); }, 2800); }
function top0(){ window.scrollTo(0, 0); }

/* ---------- acciones ---------- */
var A = {
  tab:function(v){ ui.tab = v; ui.sheet = null; ui.areaF = 'Todos'; render(); top0(); },
  nivel:function(v){ ui.nivel = v; render(); },
  areaF:function(v){ ui.areaF = v; render(); },
  close:function(){ ui.sheet = null; render(); },
  /* reportes: al abrir uno nuevo pasa solo a "en proceso" (amarillo) */
  openRep:function(v){
    var r = DB.reportes[v]; if (!r) return;
    ui.sheet = { k:'rep', id:v }; ui.sh = { diag: r.diag || '', compra: !!r.compra, cambio: !!r.cambio, costo: r.costo || '' };
    if (r.estado === 'nuevo') actualiza('reportes/' + v, { estado:'atencion', visto: now() });
    render();
  },
  saveRep:function(){ var id = ui.sheet.id, s = ui.sh; ui.sheet = null; actualiza('reportes/' + id, { diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); render(); toast('Nota guardada'); },
  resolveRep:function(){
    if (!ui.sh.diag.trim()) return toast('Anota qué encontraste y qué hiciste');
    var id = ui.sheet.id, s = ui.sh; ui.sheet = null;
    actualiza('reportes/' + id, { estado:'resuelto', resuelto: now(), diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); render();
    toast('Resuelto. Se avisó al instructor y a gerencia.');
  },
  /* preventivo */
  prevDone:function(v){ var p = DB.preventivo[v]; if (!p) return; var h = arr(p.hist).concat([now()]), pr = sod(now()) + p.freq * DAY; actualiza('preventivo/' + v, { hist:h, proxima:pr }); toast('Revisado. Próxima vez: ' + fechaTxt(pr)); },
  prevPosp:function(v){ ui.sheet = { k:'posp', id:v }; ui.sh = { motivo:'Evento del club', fecha: fechaInput(sod(now()) + 3 * DAY) }; render(); },
  motivo:function(v){ ui.sh.motivo = v; render(); },
  prevPospSave:function(){
    var id = ui.sheet.id, p = DB.preventivo[id], f = ui.sh.fecha; if (!p) return;
    if (!f) return toast('Elige la nueva fecha');
    var d = new Date(f + 'T00:00:00').getTime(), pp = arr(p.posp).concat([{ motivo: ui.sh.motivo, de: p.proxima, a: d }]);
    ui.sheet = null; actualiza('preventivo/' + id, { posp:pp, proxima:d }); render(); toast('Pospuesto al ' + fechaTxt(d));
  },
  prevNew:function(){ ui.sheet = { k:'prevform' }; ui.sh = { titulo:'', detalle:'', salonId:'', freq:7, proxima: fechaInput(sod(now())) }; render(); },
  prevEdit:function(v){ var p = DB.preventivo[v]; if (!p) return; ui.sheet = { k:'prevform', id:v }; ui.sh = { titulo:p.titulo, detalle:p.detalle || '', salonId:p.salonId || '', freq:p.freq, proxima: fechaInput(p.proxima) }; render(); },
  prevSave:function(){
    var s = ui.sh; if (!s.titulo.trim()) return toast('Escribe qué se revisa');
    if (!s.proxima) return toast('Elige la fecha de la próxima revisión');
    var id = ui.sheet.id || nuevoId('preventivo'), prox = new Date(s.proxima + 'T00:00:00').getTime();
    var campos = { titulo:s.titulo.trim(), detalle:s.detalle.trim(), salonId:s.salonId || '', freq:+s.freq, proxima:prox };
    ui.sheet = null;
    (DB.preventivo[id] ? actualiza('preventivo/' + id, campos) : guarda('preventivo/' + id, Object.assign(campos, { posp:[], hist:[] })));
    render(); toast('Revisión guardada');
  },
  prevDel:function(){ if (!confirm('¿Eliminar esta revisión programada?')) return; var id = ui.sheet.id; ui.sheet = null; guarda('preventivo/' + id, null); render(); toast('Revisión eliminada'); },
  /* equipos y salones */
  eqOpen:function(v){ ui.sheet = { k:'eq', id:v }; render(); },
  eqNew:function(){ var ss = lista('salones'); ui.sheet = { k:'eqform' }; ui.sh = { nombre:'', salonId: ss.length ? ss[0].id : '', foto:'' }; render(); },
  eqEdit:function(v){ var e = DB.equipos[v]; if (!e) return; ui.sheet = { k:'eqform', id:v }; ui.sh = { nombre:e.nombre, salonId:e.salonId, foto:e.foto || '' }; render(); },
  eqSave:function(){
    var s = ui.sh; if (!s.nombre.trim()) return toast('Escribe el nombre del equipo');
    if (!s.salonId) return toast('Elige el salón del equipo');
    var id = ui.sheet.id || nuevoId('equipos');
    guarda('equipos/' + id, { nombre:s.nombre.trim(), salonId:s.salonId, foto:s.foto.trim() });
    ui.sheet = null; render(); toast('Equipo guardado');
  },
  eqDel:function(){
    var id = ui.sheet.id; if (abiertos().some(function(r){ return r.equipoId === id; })) return toast('Tiene reportes abiertos. Ciérralos antes de eliminarlo.');
    if (!confirm('¿Eliminar este equipo del catálogo?')) return;
    ui.sheet = null; guarda('equipos/' + id, null); render(); toast('Equipo eliminado');
  },
  salones:function(){ ui.sheet = { k:'sal' }; ui.sh = { nombre:'', area:'' }; render(); },
  salAdd:function(){
    var s = ui.sh; if (!s.nombre.trim()) return toast('Escribe el nombre del salón');
    if (!s.area.trim()) return toast('Escribe el área del salón');
    guarda('salones/' + nuevoId('salones'), { nombre:s.nombre.trim(), area:s.area.trim() });
    ui.sh = { nombre:'', area:'' }; toast('Salón agregado');
  },
  salEdit:function(v){
    var s = DB.salones[v]; if (!s) return;
    var n = prompt('Nombre del salón:', s.nombre); if (n === null || !n.trim()) return;
    var a = prompt('Área del salón:', s.area); if (a === null || !a.trim()) return;
    actualiza('salones/' + v, { nombre:n.trim(), area:a.trim() }); toast('Salón actualizado');
  },
  salDel:function(v){
    if (lista('equipos').some(function(e){ return e.salonId === v; })) return toast('Este salón tiene equipos. Cámbialos de salón antes de eliminarlo.');
    if (!confirm('¿Eliminar este salón?')) return; guarda('salones/' + v, null); toast('Salón eliminado');
  },
  salonesFitness:function(){
    var up = {}, n = 0;
    SALONES_FITNESS.forEach(function(f){ if (!DB.salones[f[0]]) { up['salones/' + f[0]] = { nombre: f[1], area: f[2] }; n++; } });
    if (!n) return toast('Los salones de Fitness ya están cargados');
    db.ref().update(up).then(function(){ toast('Salones de Fitness cargados'); }).catch(function(e){ toast('No se pudo cargar: ' + e.message); });
  },
  /* datos de prueba */
  ejemplo:function(){
    if (!confirm('Se agregan equipos y revisiones de ejemplo en los salones de Fitness. Podrás editarlos o eliminarlos. ¿Continuar?')) return;
    var up = {}, d0 = sod(now());
    SALONES_FITNESS.forEach(function(f){ up['salones/' + f[0]] = { nombre: f[1], area: f[2] }; });
    [['Bicicleta spinning 01', 'salon-spinning', 'bici-01.jpg'], ['Bicicleta spinning 02', 'salon-spinning', 'bici-02.jpg'], ['Bicicleta spinning 03', 'salon-spinning', 'bici-03.jpg'],
     ['Costal de box 1', 'box', 'costal-1.jpg'], ['Rack de pesas', 'crossfit', 'rack-pesas.jpg'], ['Barra olímpica 1', 'crossfit', 'barra-1.jpg'],
     ['Bocina salón 2', 'salon-2', 'bocina-s2.jpg'], ['Aire acondicionado salón 2', 'salon-2', 'aire-s2.jpg'], ['Espejo salón 1', 'salon-1', 'espejo-s1.jpg'], ['Tapetes de yoga', 'salon-yoga', 'tapetes.jpg']
    ].forEach(function(e){ up['equipos/' + nuevoId('equipos')] = { nombre:e[0], salonId:e[1], foto:e[2], ejemplo:true }; });
    [['Bicicletas de spinning', 'Tornillería, pedales y resistencia', 'salon-spinning', 7, d0], ['Costales y soportes', 'Cadenas y anclajes', 'box', 15, d0 - 2 * DAY],
     ['Aire acondicionado salón 2', 'Limpieza de filtros', 'salon-2', 30, d0], ['Espejos y soportes · salón 1', 'Revisión de anclajes', 'salon-1', 7, d0 + DAY]
    ].forEach(function(p){ up['preventivo/' + nuevoId('preventivo')] = { titulo:p[0], detalle:p[1], salonId:p[2], freq:p[3], proxima:p[4], posp:[], hist:[], ejemplo:true }; });
    db.ref().update(up).then(function(){ toast('Catálogo de ejemplo cargado'); }).catch(function(e){ toast('No se pudo cargar: ' + e.message); });
  },
  reportesEjemplo:function(){
    var eqs = lista('equipos').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
    if (eqs.length < 1) return toast('Primero da de alta equipos o carga el catálogo de ejemplo');
    var H = 36e5, t = now(), up = {};
    var m = [
      ['No enciende, el tablero se queda apagado.', 'fuera', 31 * H, 'nuevo', null],
      ['Pedal flojo, se mueve al pedalear.', 'normal', 26 * H, 'nuevo', null],
      ['Distorsiona el sonido.', 'urgente', 9 * H, 'atencion', { diag:'Falta el cable de audio, pendiente de comprar.', compra:true, cambio:false, costo:'450', visto: t - 8 * H }],
      ['El soporte se mueve.', 'normal', 50 * H, 'resuelto', { diag:'Se cambió el soporte y quedó firme.', compra:false, cambio:true, costo:'', visto: t - 20 * H, resuelto: t - 3 * H }]
    ];
    m.forEach(function(x, i){
      var e = eqs[i % eqs.length], sa = salonById(e.salonId);
      up['reportes/' + nuevoId('reportes')] = limpia(Object.assign({ equipoId:e.id, desc:x[0], urg:x[1], profId:'ejemplo', prof:'Profesor de ejemplo', area:sa.area, clase:'Clase de ejemplo', salonId:e.salonId, otroLugar:false, creado: t - x[2], estado:x[3] }, x[4] || {}));
    });
    db.ref().update(up).then(function(){ toast('Reportes de ejemplo cargados'); }).catch(function(e){ toast('No se pudo cargar: ' + e.message); });
  },
  borraPrueba:function(){
    if (!confirm('Se borran los reportes de ejemplo y de prueba, y los equipos y revisiones del catálogo de ejemplo. ¿Continuar?')) return;
    var up = {}, esPrueba = function(r){ return r.profId === 'ejemplo' || r.profId === 'prueba'; };
    lista('reportes').filter(esPrueba).forEach(function(r){ up['reportes/' + r.id] = null; });
    lista('historial').filter(esPrueba).forEach(function(r){ up['historial/' + r.id] = null; });
    lista('equipos').filter(function(e){ return e.ejemplo; }).forEach(function(e){ up['equipos/' + e.id] = null; });
    lista('preventivo').filter(function(p){ return p.ejemplo; }).forEach(function(p){ up['preventivo/' + p.id] = null; });
    if (!Object.keys(up).length) return toast('No hay datos de prueba que borrar');
    db.ref().update(up).then(function(){ toast('Datos de prueba borrados'); }).catch(function(e){ toast('No se pudo borrar: ' + e.message); });
  }
};
document.addEventListener('click', function(e){
  if (e.target.id === 'modal') { A.close(); return; }
  var b = e.target.closest('[data-a]'); if (!b) return;
  var f = A[b.getAttribute('data-a')]; if (f) f(b.getAttribute('data-v'));
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && ui.sheet) A.close(); });
document.addEventListener('input', function(e){
  var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
  if (f && ui.sh) ui.sh[f] = t.type === 'checkbox' ? t.checked : t.value;
});
document.addEventListener('focusout', function(){ setTimeout(function(){ if (ui.dirty && !escribiendo()) render(); }, 150); });
document.addEventListener('error', function(e){ var t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) t.style.display = 'none'; }, true);
if (window.matchMedia) { var mq = window.matchMedia('(min-width: 900px)'); var onMq = function(){ softRender(); }; mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener && mq.addListener(onMq); }

initFB();
render();
setInterval(function(){ if (!escribiendo() && !ui.sheet) render(); }, 60000);   // refresca los tiempos
