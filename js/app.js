'use strict';
/* =====================================================================
   app.js — Control Mantenimiento
   Datos en Firebase Realtime Database (proyecto registro-mantenimiento):
     /salones/{id}     {nombre, area}
     /equipos/{id}     {nombre, salonId, foto}
     /reportes/{id}    reportes ABIERTOS (los manda el profesor desde Control Gerencia)
     /historial/{id}   reportes ya cerrados por el profesor
     /preventivo/{id}  {titulo, detalle, salonId, freq, proxima, posp[], hist[]}
   Vistas: Mantenimiento (la que usa el técnico), y dos vistas de prueba
   (Profesor y Gerencia) para revisar el flujo antes de conectar Control Gerencia.
   ===================================================================== */
var DAY = 864e5, HR = 36e5, CACHE_KEY = 'cm_cache_v1';
var URG_TXT = { normal: 'Normal', urgente: 'Urgente', fuera: 'No se puede usar' };
var UMBRAL = (typeof UMBRAL_HORAS !== 'undefined') ? UMBRAL_HORAS : { normal: 24, urgente: 4, fuera: 2 };

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
    db.ref('historial').limitToLast(100).on('value', function(s){ DB.historial = s.val() || {}; cacheSave(); softRender(); }, function(){});
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
var ui = { rol:'mant', tab:{ mant:'reportes', prueba:'reportar', ger:'resumen' }, filtro:'todos', areaF:'Todos',
  sel:null, q:'', desc:'', urg:'normal', pSalon:'', otro:false, sh:null, sheet:null, toast:'', dirty:false };

/* ---------- datos derivados ---------- */
function eqById(id){ return Object.assign({ id: id, nombre:'Equipo (eliminado)', salonId:'', foto:'' }, (DB.equipos || {})[id] || {}); }
function salonById(id){ return Object.assign({ id: id, nombre:'—', area:'' }, (DB.salones || {})[id] || {}); }
function eqLugar(e){ return salonById(e.salonId).nombre; }
function eqArea(e){ return salonById(e.salonId).area; }
function abiertos(){ return lista('reportes'); }
function vencido(r){ return r.estado === 'nuevo' && (now() - r.creado) / HR > (UMBRAL[r.urg] || 24); }
function diasPrev(p){ return Math.round((p.proxima - sod(now())) / DAY); }
function eqEstado(id){
  var rs = abiertos().filter(function(r){ return r.equipoId === id; });
  if (rs.some(function(r){ return r.urg === 'fuera' && r.estado !== 'resuelto'; })) return { t:'Fuera de servicio', c:'var(--redline)' };
  if (rs.some(vencido)) return { t:'Reporte sin atender', c:'var(--redline)' };
  if (rs.some(function(r){ return r.estado === 'atencion'; })) return { t:'En atención', c:'#B07A00' };
  if (rs.length) return { t:'Con reporte abierto', c:'#B07A00' };
  return { t:'Sin pendientes', c:'#1B6E45' };
}
function sortRep(a, b){
  var k = function(r){ return vencido(r) ? 0 : r.estado === 'nuevo' ? 1 : r.estado === 'atencion' ? 2 : 3; };
  return k(a) - k(b) || a.creado - b.creado;
}

/* ---------- iconos ---------- */
var IC = {
  img:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
  tool:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/></svg>',
  chat:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  cal:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  grid:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  chart:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'
};

/* ---------- encabezado y navegación ---------- */
function header(){
  var estado = fbError ? { t:'Sin conexión con la base', c:'var(--redline)' } : online ? { t:'Conectado', c:'#1B6E45' } : { t:'Sin internet', c:'#B07A00' };
  return '<header class="top"><div class="brand"><div><b>Control Mantenimiento</b><br><small>Club Campestre</small></div>' +
    '<span class="conn" style="color:' + estado.c + '"><i style="background:' + estado.c + '"></i>' + estado.t + '</span></div>' +
    '<div class="seg" role="group" aria-label="Ver como">' +
    [['mant','Mantenimiento'], ['prueba','Profesor (prueba)'], ['ger','Gerencia (vista)']].map(function(x){
      return '<button data-a="rol" data-v="' + x[0] + '" aria-pressed="' + (ui.rol === x[0]) + '">' + x[1] + '</button>';
    }).join('') + '</div>' +
    (fbError ? '<div class="err" style="margin-top:8px">' + esc(fbError) + '</div>' : '') +
    (!online && !fbError ? '<div class="sub" style="margin-top:6px">Sin internet: los cambios se envían al volver la señal. No cierres la app hasta entonces.</div>' : '') +
    '</header>';
}
function navBar(){
  var items, cur = ui.tab[ui.rol];
  var nSin = abiertos().filter(vencido).length;
  var nVen = lista('preventivo').filter(function(p){ return diasPrev(p) < 0; }).length;
  var nMine = abiertos().filter(function(r){ return r.profId === 'prueba' && (vencido(r) || r.estado === 'resuelto'); }).length;
  if (ui.rol === 'prueba') items = [['reportar','Reportar',IC.tool,0], ['mis','Mis reportes',IC.chat,nMine]];
  else if (ui.rol === 'mant') items = [['reportes','Reportes',IC.chat,nSin], ['preventivo','Preventivo',IC.cal,nVen], ['equipos','Equipos',IC.grid,0]];
  else items = [['resumen','Resumen',IC.chart,0], ['equipos','Equipos',IC.grid,0]];
  return '<nav class="bar" aria-label="Secciones"><div>' + items.map(function(i){
    return '<button data-a="tab" data-v="' + i[0] + '"' + (cur === i[0] ? ' aria-current="page"' : '') + '>' + i[2] + i[1] +
      (i[3] ? '<span class="badge" aria-label="' + i[3] + ' pendientes">' + i[3] + '</span>' : '') + '</button>';
  }).join('') + '</div></nav>';
}

/* ---------- tarjetas ---------- */
function tagFor(r){
  if (r.estado === 'resuelto') return '<span class="tag grn">Resuelto</span>';
  if (vencido(r)) return '<span class="tag red">Sin atender · ' + hace(r.creado).replace('hace ', '') + '</span>';
  if (r.estado === 'atencion') return '<span class="tag amb">En atención</span>';
  return '<span class="tag">Nuevo · ' + hace(r.creado) + '</span>';
}
function repCard(r, modo){
  var e = eqById(r.equipoId), rojo = vencido(r);
  var cls = 'card' + (rojo ? ' red' : r.estado === 'atencion' ? ' amb' : r.estado === 'resuelto' ? ' grn' : '');
  var extra = '';
  if (r.estado !== 'nuevo' && r.diag) extra += '<div style="font-size:14px"><b>Diagnóstico:</b> ' + esc(r.diag) + '</div>';
  if (r.compra || r.cambio) extra += '<div class="mut">' + (r.compra ? 'Requiere compra' : '') + (r.compra && r.cambio ? ' · ' : '') + (r.cambio ? 'Requiere cambio' : '') + (r.costo ? ' · estimado $' + esc(r.costo) : '') + '</div>';
  var acc = '';
  if (modo === 'mant') acc = '<button class="btn ' + (rojo ? 'red' : r.estado === 'resuelto' ? '' : 'pri') + '" data-a="openRep" data-v="' + r.id + '">' + (r.estado === 'nuevo' ? 'Atender' : r.estado === 'atencion' ? 'Seguir atendiendo' : 'Ver detalle') + '</button>';
  else if (modo === 'prof' && r.estado === 'resuelto') acc = '<button class="btn pri" data-a="delRep" data-v="' + r.id + '">Eliminar aviso</button>';
  return '<article class="' + cls + '"><div class="row">' + tagFor(r) + '<span class="mut">' + (r.urg !== 'normal' ? '<b>' + URG_TXT[r.urg] + '</b>' : 'Normal') + '</span></div>' +
    '<div><div class="ttl">' + esc(e.nombre) + '</div><div style="font-size:14px">' + esc(r.desc) + '</div>' +
    '<div class="mut">' + esc(eqLugar(e)) + '</div><div class="mut">' + esc(r.prof) + (r.area ? ' · ' + esc(r.area) : '') + (r.clase ? ' · ' + esc(r.clase) : '') + '</div>' +
    (r.otroLugar ? '<div class="mut"><b>Reportado desde otro salón</b></div>' : '') + '</div>' + extra + acc + '</article>';
}
function prevCard(p, ro){
  var d = diasPrev(p), rojo = d < 0;
  var cuando = d < 0 ? 'Venció hace ' + (-d) + (d === -1 ? ' día' : ' días') : d === 0 ? 'Toca hoy' : d === 1 ? 'Mañana' : 'Toca el ' + fechaTxt(p.proxima);
  var pp = arr(p.posp);
  var posp = pp.length ? '<div class="mut">Pospuesto ' + pp.length + (pp.length === 1 ? ' vez' : ' veces') + ' · último motivo: ' + esc(pp[pp.length - 1].motivo) + '</div>' : '';
  var lug = p.salonId ? salonById(p.salonId).nombre : '';
  return '<article class="card' + (rojo ? ' red' : '') + '"><div><div class="ttl">' + esc(p.titulo) + '</div>' +
    (p.detalle ? '<div style="font-size:14px">' + esc(p.detalle) + '</div>' : '') + (lug ? '<div class="mut">' + esc(lug) + '</div>' : '') +
    '<div class="mut" style="font-weight:600">' + cuando + '</div></div>' + posp +
    (ro ? '' : '<div class="btns"><button class="btn ' + (rojo ? 'red' : 'pri') + '" data-a="prevDone" data-v="' + p.id + '">Ya se revisó</button><button class="btn" data-a="prevPosp" data-v="' + p.id + '">Posponer</button></div>' +
      '<button class="btn sm" data-a="prevEdit" data-v="' + p.id + '">Editar</button>') + '</article>';
}

/* ---------- Mantenimiento ---------- */
function empiezaAqui(){
  if (lista('salones').length || lista('equipos').length) return '';
  return '<div class="card"><div class="ttl">Empieza aquí</div><div class="sub">Todavía no hay salones ni equipos. Primero da de alta los salones o zonas, y luego los equipos de cada uno. Así a cada profesor solo le aparecen los equipos de su salón.</div>' +
    '<button class="btn pri" data-a="salonesFitness">Cargar los salones de Fitness</button><button class="btn" data-a="salones">Dar de alta salones a mano</button><button class="btn" data-a="ejemplo">Cargar catálogo de ejemplo</button></div>';
}
function vMantReportes(){
  var all = abiertos(), l = all.slice();
  if (ui.filtro === 'sin') l = l.filter(function(r){ return r.estado === 'nuevo'; });
  if (ui.filtro === 'atencion') l = l.filter(function(r){ return r.estado === 'atencion'; });
  if (ui.filtro === 'compras') l = l.filter(function(r){ return (r.compra || r.cambio) && r.estado !== 'resuelto'; });
  l.sort(sortRep);
  var cSin = all.filter(vencido).length, cAt = all.filter(function(r){ return r.estado === 'atencion' || (r.estado === 'nuevo' && !vencido(r)); }).length, cRes = all.filter(function(r){ return r.estado === 'resuelto'; }).length;
  return '<h1 class="h1">Reportes</h1>' + empiezaAqui() +
    '<div class="kpis"><div class="kpi red"><b>' + cSin + '</b><span>En rojo</span></div><div class="kpi amb"><b>' + cAt + '</b><span>En proceso</span></div><div class="kpi grn"><b>' + cRes + '</b><span>Resueltos</span></div></div>' +
    '<div class="chips">' + [['todos','Todos'], ['sin','Sin atender'], ['atencion','En atención'], ['compras','Compras']].map(function(f){
      return '<button class="chip" data-a="filtro" data-v="' + f[0] + '" aria-pressed="' + (ui.filtro === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    (l.length ? l.map(function(r){ return repCard(r, 'mant'); }).join('') : '<div class="empty">' + (ready ? 'No hay reportes en esta lista.' : 'Cargando…') + '</div>') + pruebaCard();
}
function pruebaCard(){
  return '<div class="card" style="margin-top:8px"><div class="ttl">Datos de prueba</div>' +
    '<div class="sub">Para probar sin esperar. Los reportes de ejemplo incluyen casos en rojo, en atención y resueltos. “Borrar datos de prueba” quita los reportes de ejemplo y de la vista de prueba, y los equipos y revisiones del catálogo de ejemplo. No toca los salones ni lo que tú diste de alta.</div>' +
    '<button class="btn" data-a="reportesEjemplo">Cargar reportes de ejemplo</button><button class="btn danger" data-a="borraPrueba">Borrar datos de prueba</button></div>';
}
function vMantPrev(){
  var l = lista('preventivo').sort(function(a, b){ return a.proxima - b.proxima; });
  var ven = l.filter(function(p){ return diasPrev(p) < 0; }), hoy = l.filter(function(p){ return diasPrev(p) === 0; }), prox = l.filter(function(p){ return diasPrev(p) > 0; });
  return '<div class="row"><h1 class="h1">Hoy te toca</h1><button class="btn pri sm" data-a="prevNew">Agregar</button></div><div class="sub">' + esc(fechaTxt(sod(now()))) + '</div>' +
    (!l.length ? '<div class="empty">Todavía no hay revisiones programadas. Toca “Agregar” para crear la primera, con su frecuencia.</div>' : '') +
    (ven.length ? '<div class="sec red">Vencido · ' + ven.length + '</div>' + ven.map(function(p){ return prevCard(p); }).join('') : '') +
    (l.length ? '<div class="sec">Para hoy · ' + hoy.length + '</div>' + (hoy.length ? hoy.map(function(p){ return prevCard(p); }).join('') : '<div class="empty">Nada más para hoy.</div>') +
      '<div class="sec">Próximos</div>' + (prox.length ? prox.map(function(p){ return prevCard(p); }).join('') : '<div class="empty">No hay preventivos próximos.</div>') : '');
}
function vEquipos(ro){
  var eqs = lista('equipos').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
  var areas = ['Todos'].concat(eqs.map(function(e){ return eqArea(e); }).filter(function(a, i, ar){ return a && ar.indexOf(a) === i; }));
  var l = eqs.filter(function(e){ return ui.areaF === 'Todos' || eqArea(e) === ui.areaF; });
  return '<div class="row"><h1 class="h1">Equipos</h1>' + (ro ? '' : '<div style="display:flex;gap:6px"><button class="btn sm" data-a="salones">Salones</button><button class="btn pri sm" data-a="eqNew">Agregar</button></div>') + '</div>' +
    (ro ? '' : empiezaAqui()) +
    (areas.length > 1 ? '<div class="chips">' + areas.map(function(a){ return '<button class="chip" data-a="areaF" data-v="' + esc(a) + '" aria-pressed="' + (ui.areaF === a) + '">' + esc(a) + '</button>'; }).join('') + '</div>' : '') +
    (l.length ? '<div class="grid2">' + l.map(function(e){
      var s = eqEstado(e.id);
      return '<button class="eq" data-a="eqOpen" data-v="' + e.id + '"><div class="pic">' + IC.img + (e.foto ? esc(e.foto) : '') +
        (e.foto ? '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '</div><div class="inf"><b style="font-weight:600;font-size:15px">' + esc(e.nombre) + '</b><span class="mut">' + esc(eqLugar(e)) + '</span><span class="st" style="color:' + s.c + '"><i style="background:' + s.c + '"></i>' + s.t + '</span></div></button>';
    }).join('') + '</div>' : '<div class="empty">No hay equipos en esta lista.</div>');
}

/* ---------- Gerencia (vista de lectura) ---------- */
function vGerResumen(){
  var ab = abiertos(), rojos = ab.filter(vencido).sort(sortRep), pv = lista('preventivo');
  var ven = pv.filter(function(p){ return diasPrev(p) < 0; });
  var pospN = pv.reduce(function(n, p){ return n + arr(p.posp).length; }, 0);
  var compras = ab.filter(function(r){ return (r.compra || r.cambio) && r.estado !== 'resuelto'; });
  var total = compras.reduce(function(n, r){ return n + (parseFloat(r.costo) || 0); }, 0);
  var porCerrar = ab.filter(function(r){ return r.estado === 'resuelto'; }).length;
  return '<h1 class="h1">Resumen de mantenimiento</h1><div class="sub">Solo lectura. Se actualiza cuando mantenimiento o los profesores capturan.</div>' +
    '<div class="kpis"><div class="kpi red"><b>' + rojos.length + '</b><span>Reportes en rojo</span></div><div class="kpi amb"><b>' + ab.filter(function(r){ return r.estado !== 'resuelto'; }).length + '</b><span>Abiertos</span></div><div class="kpi grn"><b>' + porCerrar + '</b><span>Por cerrar</span></div></div>' +
    '<div class="kpis"><div class="kpi' + (ven.length ? ' red' : '') + '"><b>' + ven.length + '</b><span>Preventivos vencidos</span></div><div class="kpi"><b>' + pospN + '</b><span>Pospuestos</span></div><div class="kpi"><b>' + compras.length + '</b><span>Compras o cambios</span></div></div>' +
    (total ? '<div class="card"><div class="row"><span>Estimado de compras pendientes</span><b>$' + total.toLocaleString('es-MX') + '</b></div></div>' : '') +
    '<div class="sec red">Reportes en rojo</div>' + (rojos.length ? rojos.map(function(r){ return repCard(r, 'ger'); }).join('') : '<div class="empty">No hay reportes en rojo.</div>') +
    '<div class="sec">Preventivos vencidos</div>' + (ven.length ? ven.map(function(p){ return prevCard(p, true); }).join('') : '<div class="empty">Todo el preventivo va al corriente.</div>') +
    '<div class="sec">Compras y cambios pendientes</div>' + (compras.length ? compras.map(function(r){ return repCard(r, 'ger'); }).join('') : '<div class="empty">No hay compras pendientes.</div>');
}

/* ---------- Profesor (vista de prueba; el real vive en Control Gerencia) ---------- */
function salonPrueba(){
  var ss = lista('salones'); if (!ss.length) return null;
  return ss.find(function(s){ return s.id === ui.pSalon; }) || ss[0];
}
function pickList(){
  var sa = salonPrueba(); if (!sa) return '<div class="empty">Primero da de alta salones y equipos en la vista de Mantenimiento.</div>';
  var q = ui.q.trim().toLowerCase();
  var base = lista('equipos').filter(function(e){ return ui.otro || e.salonId === sa.id; });
  var l = base.filter(function(e){ return !q || (e.nombre + ' ' + eqLugar(e)).toLowerCase().indexOf(q) >= 0; }).slice(0, 10);
  if (!l.length) return '<div class="empty">No hay equipos con ese nombre en esta lista. Si no aparece, toca “Mi equipo no está en esta lista”.</div>';
  return l.map(function(e){
    var otra = ui.otro && eqArea(e) !== sa.area ? ' · área ' + eqArea(e) : '';
    return '<button class="pick" data-a="pick" data-v="' + e.id + '" aria-pressed="' + (ui.sel === e.id) + '"><span class="ph">' + IC.img + '</span>' +
      '<span style="flex:1"><b style="font-weight:600">' + esc(e.nombre) + '</b><br><span class="mut">' + esc(eqLugar(e)) + otra + '</span></span></button>';
  }).join('');
}
function vProfReportar(){
  var sa = salonPrueba(), chips = ['No enciende', 'Ruido extraño', 'Flojo o roto', 'Falta pieza'];
  var ss = lista('salones');
  return '<h1 class="h1">Reportar equipo</h1><div class="sub">Vista de prueba. En Control Gerencia el profesor entra con su PIN y su clase se elige sola.</div>' +
    (sa ? '<div class="card"><label class="lbl" for="psalon">Tu clase se da en</label><select id="psalon" class="fld">' +
      ss.map(function(s){ return '<option value="' + s.id + '"' + (s.id === sa.id ? ' selected' : '') + '>' + esc(s.nombre) + ' · ' + esc(s.area) + '</option>'; }).join('') + '</select>' +
      '<div class="sub">' + (ui.otro ? 'Estás viendo equipos de todo el club.' : 'Se muestran solo los equipos de ' + esc(sa.nombre) + '.') + '</div></div>' : '') +
    '<div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="q">¿Qué equipo es?</label>' +
    '<input id="q" class="fld" type="search" placeholder="Buscar por nombre o salón" value="' + esc(ui.q) + '" autocomplete="off">' +
    '<div id="pick" style="display:flex;flex-direction:column;gap:8px">' + pickList() + '</div>' +
    '<button class="mini" data-a="otro" style="align-self:flex-start;height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--surface)">' + (ui.otro ? 'Volver a los equipos de mi salón' : 'Mi equipo no está en esta lista') + '</button></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="desc">¿Qué pasa?</label>' +
    '<div class="chips">' + chips.map(function(c){ return '<button class="chip" data-a="chip" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div>' +
    '<textarea id="desc" class="fld" placeholder="Describe lo que notaste">' + esc(ui.desc) + '</textarea></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">¿Qué tan urgente es?</span><div class="chips">' +
    ['normal', 'urgente', 'fuera'].map(function(u){ return '<button class="chip" data-a="urg" data-v="' + u + '" aria-pressed="' + (ui.urg === u) + '">' + URG_TXT[u] + '</button>'; }).join('') + '</div></div>' +
    '<button class="btn pri block" data-a="send">Enviar a mantenimiento</button>' +
    '<div class="sub" style="text-align:center">Le llega a mantenimiento, gerencia y dirección. Si nadie lo atiende, se pone en rojo.</div>';
}
function vProfMis(){
  var l = abiertos().filter(function(r){ return r.profId === 'prueba'; }).sort(sortRep);
  return '<h1 class="h1">Mis reportes</h1><div class="sub">Cuando mantenimiento termine, aparece como resuelto y tú lo eliminas.</div>' +
    (l.length ? l.map(function(r){ return repCard(r, 'prof'); }).join('') : '<div class="empty">No tienes reportes abiertos. Los nuevos aparecen aquí.</div>');
}

/* ---------- hojas ---------- */
function sheetWrap(inner){ return '<div class="ov"><button class="bd" data-a="close" aria-label="Cerrar"></button><div class="sheet" role="dialog" aria-modal="true">' + inner + '</div></div>'; }
function cab(t){ return '<div class="row"><h2 class="h1" style="font-size:24px">' + esc(t) + '</h2><button class="mini" data-a="close" style="height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--surface)">Cerrar</button></div>'; }
function opcionesSalon(sel, vacio){
  return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista('salones').map(function(s){ return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.nombre) + ' · ' + esc(s.area) + '</option>'; }).join('');
}
function sheetRep(){
  var r = DB.reportes[ui.sheet.id]; if (!r) return '';
  r = Object.assign({ id: ui.sheet.id }, r);
  var e = eqById(r.equipoId), sh = ui.sh, hecho = r.estado === 'resuelto';
  return sheetWrap(cab(e.nombre) +
    '<div class="row">' + tagFor(r) + '<span class="mut">' + URG_TXT[r.urg] + '</span></div>' +
    '<div class="card"><div class="mut">Lo que reportó ' + esc(r.prof) + (r.area ? ' (' + esc(r.area) + (r.clase ? ' · ' + esc(r.clase) : '') + ')' : '') + ' · ' + hace(r.creado) + '</div><div class="pre">' + esc(r.desc) + '</div></div>' +
    '<label class="lbl" for="f-diag">Qué encontraste y qué hiciste</label>' +
    '<textarea id="f-diag" class="fld" data-f="diag"' + (hecho ? ' disabled' : '') + ' placeholder="Describe la anomalía y la atención">' + esc(sh.diag) + '</textarea>' +
    '<label class="chk"><input type="checkbox" data-f="compra"' + (sh.compra ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita comprar algo</label>' +
    '<label class="chk"><input type="checkbox" data-f="cambio"' + (sh.cambio ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita cambio de pieza o equipo</label>' +
    '<label class="lbl" for="f-costo">Costo estimado (opcional)</label>' +
    '<input id="f-costo" class="fld" inputmode="decimal" data-f="costo" value="' + esc(sh.costo) + '" placeholder="0"' + (hecho ? ' disabled' : '') + '>' +
    (hecho ? '<div class="sub">Este reporte ya está resuelto. Se quita cuando el profesor lo elimine.</div>' :
      '<div class="btns">' + (r.estado === 'nuevo' ? '<button class="btn" data-a="takeRep">Tomar reporte</button>' : '<button class="btn" data-a="saveRep">Guardar nota</button>') +
      '<button class="btn pri" data-a="resolveRep">Marcar resuelto</button></div>'));
}
function sheetPosp(){
  var p = DB.preventivo[ui.sheet.id]; if (!p) return '';
  var motivos = ['Evento del club', 'Falta refacción', 'Falta personal', 'Otro'];
  return sheetWrap(cab('Posponer') + '<div class="card"><div class="ttl">' + esc(p.titulo) + '</div><div class="mut">' + esc(p.detalle || '') + '</div></div>' +
    '<span class="lbl">Motivo</span><div class="chips">' + motivos.map(function(m){ return '<button class="chip" data-a="motivo" data-v="' + m + '" aria-pressed="' + (ui.sh.motivo === m) + '">' + m + '</button>'; }).join('') + '</div>' +
    '<label class="lbl" for="f-fecha">Nueva fecha</label><input id="f-fecha" class="fld" type="date" data-f="fecha" min="' + fechaInput(sod(now()) + DAY) + '" value="' + esc(ui.sh.fecha) + '">' +
    '<button class="btn pri block" data-a="prevPospSave">Guardar nueva fecha</button><div class="sub">Gerencia ve cuántas veces se pospone un preventivo y por qué.</div>');
}
function sheetEq(){
  var raw = DB.equipos[ui.sheet.id]; if (!raw) return '';
  var e = eqById(ui.sheet.id), s = eqEstado(e.id);
  var h = abiertos().concat(lista('historial')).filter(function(r){ return r.equipoId === e.id; }).sort(function(a, b){ return b.creado - a.creado; });
  return sheetWrap(cab(e.nombre) +
    '<div class="eq" style="cursor:default"><div class="pic" style="height:130px">' + IC.img + esc(e.foto || '') + (e.foto ? '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
    '<div class="mut">' + esc(eqLugar(e)) + ' · ' + esc(eqArea(e)) + '</div><span class="st" style="color:' + s.c + '"><i style="background:' + s.c + '"></i>' + s.t + '</span>' +
    (ui.rol === 'mant' ? '<button class="btn" data-a="eqEdit" data-v="' + e.id + '">Editar equipo</button>' : '') +
    '<div class="sec">Historial</div>' + (h.length ? h.map(function(r){
      return '<div class="card"><div class="row">' + (r.cerrado ? '<span class="tag grn">Cerrado</span>' : tagFor(r)) + '<span class="mut">' + hace(r.creado) + '</span></div><div style="font-size:14px">' + esc(r.desc) + '</div>' + (r.diag ? '<div class="mut">' + esc(r.diag) + '</div>' : '') + '</div>';
    }).join('') : '<div class="empty">Este equipo no tiene reportes.</div>'));
}
function sheetEqForm(){
  var nuevo = !ui.sheet.id;
  if (!lista('salones').length) return sheetWrap(cab('Agregar equipo') + '<div class="empty">Primero da de alta al menos un salón o zona. Toca “Salones” en la pantalla de Equipos.</div>');
  return sheetWrap(cab(nuevo ? 'Agregar equipo' : 'Editar equipo') +
    '<label class="lbl" for="n-nom">Nombre</label><input id="n-nom" class="fld" data-f="nombre" placeholder="Ej. Bicicleta spinning 04" value="' + esc(ui.sh.nombre) + '">' +
    '<label class="lbl" for="n-sal">Salón o zona</label><select id="n-sal" class="fld" data-f="salonId">' + opcionesSalon(ui.sh.salonId) + '</select>' +
    '<div class="sub">El equipo solo le aparece a los profesores cuyas clases se dan en ese salón.</div>' +
    '<label class="lbl" for="n-foto">Nombre del archivo de foto</label><input id="n-foto" class="fld" data-f="foto" placeholder="bici-04.jpg" value="' + esc(ui.sh.foto) + '">' +
    '<div class="sub">La foto se sube al repositorio, carpeta img/equipos, y se llama por este nombre.</div>' +
    '<button class="btn pri block" data-a="eqSave">Guardar equipo</button>' +
    (nuevo ? '' : '<button class="btn danger" data-a="eqDel">Eliminar equipo</button>'));
}
function sheetSalones(){
  var ss = lista('salones').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
  return sheetWrap(cab('Salones y zonas') +
    '<div class="sub">Cada equipo pertenece a un salón. El nombre debe ser igual al del salón en Control Fitness, para que a cada instructor le salgan los equipos de su salón.</div>' +
    (SALONES_FITNESS.some(function(f){ return !DB.salones[f[0]]; }) ? '<button class="btn pri" data-a="salonesFitness">Cargar los salones de Fitness</button>' : '') +
    (ss.length ? ss.map(function(s){
      return '<div class="card"><div class="row"><div><div class="ttl">' + esc(s.nombre) + '</div><div class="mut">Área ' + esc(s.area) + '</div></div></div>' +
        '<div class="btns"><button class="btn sm" data-a="salEdit" data-v="' + s.id + '">Renombrar</button><button class="btn sm danger" data-a="salDel" data-v="' + s.id + '">Eliminar</button></div></div>';
    }).join('') : '<div class="empty">Todavía no hay salones.</div>') +
    '<div class="sec">Agregar salón</div>' +
    '<label class="lbl" for="s-nom">Nombre del salón o zona</label><input id="s-nom" class="fld" data-f="nombre" placeholder="Ej. Salón de Spinning" value="' + esc(ui.sh.nombre) + '">' +
    '<label class="lbl" for="s-area">Área</label><input id="s-area" class="fld" data-f="area" list="areas" placeholder="Ej. Spinning, Gimnasio, Salones" value="' + esc(ui.sh.area) + '">' +
    '<datalist id="areas">' + ss.map(function(s){ return s.area; }).filter(function(a, i, ar){ return a && ar.indexOf(a) === i; }).map(function(a){ return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
    '<button class="btn pri block" data-a="salAdd">Agregar salón</button>');
}
function sheetPrevForm(){
  var nuevo = !ui.sheet.id, fr = [[7, 'Cada semana'], [15, 'Cada 15 días'], [30, 'Cada mes'], [90, 'Cada 3 meses'], [180, 'Cada 6 meses'], [365, 'Cada año']];
  return sheetWrap(cab(nuevo ? 'Agregar revisión' : 'Editar revisión') +
    '<label class="lbl" for="p-tit">Qué se revisa</label><input id="p-tit" class="fld" data-f="titulo" placeholder="Ej. Bicicletas de spinning" value="' + esc(ui.sh.titulo) + '">' +
    '<label class="lbl" for="p-det">Detalle (opcional)</label><input id="p-det" class="fld" data-f="detalle" placeholder="Ej. Tornillería, pedales y resistencia" value="' + esc(ui.sh.detalle) + '">' +
    '<label class="lbl" for="p-sal">Dónde</label><select id="p-sal" class="fld" data-f="salonId">' + opcionesSalon(ui.sh.salonId, 'En general') + '</select>' +
    '<label class="lbl" for="p-fr">Frecuencia</label><select id="p-fr" class="fld" data-f="freq">' + fr.map(function(f){ return '<option value="' + f[0] + '"' + (+ui.sh.freq === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>' +
    '<label class="lbl" for="p-fe">Próxima revisión</label><input id="p-fe" class="fld" type="date" data-f="proxima" value="' + esc(ui.sh.proxima) + '">' +
    '<button class="btn pri block" data-a="prevSave">Guardar revisión</button>' + (nuevo ? '' : '<button class="btn danger" data-a="prevDel">Eliminar revisión</button>'));
}

/* ---------- render ---------- */
function render(){
  ui.dirty = false;
  var t = ui.tab[ui.rol], body = '';
  if (ui.rol === 'prueba') body = t === 'reportar' ? vProfReportar() : vProfMis();
  else if (ui.rol === 'mant') body = t === 'reportes' ? vMantReportes() : t === 'preventivo' ? vMantPrev() : vEquipos(false);
  else body = t === 'resumen' ? vGerResumen() : vEquipos(true);
  document.getElementById('app').innerHTML = header() + '<main class="main">' + body + '</main>' + navBar();
  var s = '', k = ui.sheet && ui.sheet.k;
  if (k) s = k === 'rep' ? sheetRep() : k === 'posp' ? sheetPosp() : k === 'eq' ? sheetEq() : k === 'eqform' ? sheetEqForm() : k === 'sal' ? sheetSalones() : sheetPrevForm();
  document.getElementById('sheet').innerHTML = s;
  document.getElementById('toast').innerHTML = ui.toast ? '<div class="toast" role="status">' + esc(ui.toast) + '</div>' : '';
}
function escribiendo(){ var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
function softRender(){ if (escribiendo()) { ui.dirty = true; return; } render(); }
var toastT;
function toast(m){ ui.toast = m; render(); clearTimeout(toastT); toastT = setTimeout(function(){ ui.toast = ''; var t = document.getElementById('toast'); if (t) t.innerHTML = ''; }, 3200); }

/* ---------- acciones ---------- */
function unRep(){ return Object.assign({ id: ui.sheet.id }, DB.reportes[ui.sheet.id] || {}); }
var A = {
  rol:function(v){ ui.rol = v; ui.sheet = null; ui.filtro = 'todos'; ui.areaF = 'Todos'; render(); window.scrollTo(0, 0); },
  tab:function(v){ ui.tab[ui.rol] = v; ui.sheet = null; ui.areaF = 'Todos'; render(); window.scrollTo(0, 0); },
  filtro:function(v){ ui.filtro = v; render(); },
  areaF:function(v){ ui.areaF = v; render(); },
  close:function(){ ui.sheet = null; render(); },
  /* profesor (prueba) */
  pick:function(v){ ui.sel = v; render(); },
  chip:function(v){ ui.desc = ui.desc ? ui.desc.replace(/\s+$/, '') + '. ' + v : v; render(); },
  urg:function(v){ ui.urg = v; render(); },
  otro:function(){ ui.otro = !ui.otro; ui.sel = null; render(); },
  send:function(){
    var sa = salonPrueba(); if (!sa) return toast('Primero da de alta salones y equipos');
    if (!ui.sel) return toast('Elige primero el equipo');
    if (!ui.desc.trim()) return toast('Describe qué pasa');
    var eq = eqById(ui.sel), id = nuevoId('reportes');
    guarda('reportes/' + id, limpia({ equipoId: ui.sel, desc: ui.desc.trim(), urg: ui.urg, profId: 'prueba', prof: 'Profesor de prueba', area: sa.area, clase: 'Clase de prueba', salonId: sa.id, otroLugar: eq.salonId !== sa.id, creado: now(), estado: 'nuevo' }));
    ui.sel = null; ui.desc = ''; ui.q = ''; ui.urg = 'normal'; ui.otro = false; ui.tab.prueba = 'mis';
    toast('Reporte enviado a mantenimiento, gerencia y dirección'); window.scrollTo(0, 0);
  },
  delRep:function(v){
    var r = DB.reportes[v]; if (!r) return;
    var up = {}; up['reportes/' + v] = null; up['historial/' + v] = limpia(Object.assign({}, r, { cerrado: now() }));
    db.ref().update(up).then(function(){ toast('Aviso eliminado'); }).catch(function(e){ toast('No se pudo eliminar: ' + e.message); });
  },
  /* reportes */
  openRep:function(v){ var r = DB.reportes[v] || {}; ui.sheet = { k:'rep', id:v }; ui.sh = { diag: r.diag || '', compra: !!r.compra, cambio: !!r.cambio, costo: r.costo || '' }; render(); },
  takeRep:function(){ var id = ui.sheet.id, s = ui.sh; ui.sheet = null; actualiza('reportes/' + id, { estado:'atencion', diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); toast('Reporte en atención. Ya no está en rojo.'); },
  saveRep:function(){ var id = ui.sheet.id, s = ui.sh; ui.sheet = null; actualiza('reportes/' + id, { diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); toast('Nota guardada'); },
  resolveRep:function(){
    if (!ui.sh.diag.trim()) return toast('Anota qué encontraste y qué hiciste');
    var id = ui.sheet.id, s = ui.sh; ui.sheet = null;
    actualiza('reportes/' + id, { estado:'resuelto', resuelto: now(), diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo });
    toast('Resuelto. Se avisó al profesor, gerencia y dirección.');
  },
  /* preventivo */
  prevDone:function(v){ var p = DB.preventivo[v]; if (!p) return; var h = arr(p.hist).concat([now()]), pr = sod(now()) + p.freq * DAY; actualiza('preventivo/' + v, { hist:h, proxima:pr }); toast('Revisado. Próxima vez: ' + fechaTxt(pr)); },
  prevPosp:function(v){ ui.sheet = { k:'posp', id:v }; ui.sh = { motivo:'Evento del club', fecha: fechaInput(sod(now()) + 3 * DAY) }; render(); },
  motivo:function(v){ ui.sh.motivo = v; render(); },
  prevPospSave:function(){
    var id = ui.sheet.id, p = DB.preventivo[id], f = ui.sh.fecha; if (!p) return;
    if (!f) return toast('Elige la nueva fecha');
    var d = new Date(f + 'T00:00:00').getTime(), pp = arr(p.posp).concat([{ motivo: ui.sh.motivo, de: p.proxima, a: d }]);
    ui.sheet = null; actualiza('preventivo/' + id, { posp:pp, proxima:d }); toast('Pospuesto al ' + fechaTxt(d));
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
    toast('Revisión guardada');
  },
  prevDel:function(){ if (!confirm('¿Eliminar esta revisión programada?')) return; var id = ui.sheet.id; ui.sheet = null; guarda('preventivo/' + id, null); toast('Revisión eliminada'); },
  /* equipos y salones */
  eqOpen:function(v){ ui.sheet = { k:'eq', id:v }; render(); },
  eqNew:function(){ var ss = lista('salones'); ui.sheet = { k:'eqform' }; ui.sh = { nombre:'', salonId: ss.length ? ss[0].id : '', foto:'' }; render(); },
  eqEdit:function(v){ var e = DB.equipos[v]; if (!e) return; ui.sheet = { k:'eqform', id:v }; ui.sh = { nombre:e.nombre, salonId:e.salonId, foto:e.foto || '' }; render(); },
  eqSave:function(){
    var s = ui.sh; if (!s.nombre.trim()) return toast('Escribe el nombre del equipo');
    if (!s.salonId) return toast('Elige el salón del equipo');
    var id = ui.sheet.id || nuevoId('equipos');
    guarda('equipos/' + id, { nombre:s.nombre.trim(), salonId:s.salonId, foto:s.foto.trim() });
    ui.sheet = null; toast('Equipo guardado');
  },
  eqDel:function(){
    var id = ui.sheet.id; if (abiertos().some(function(r){ return r.equipoId === id; })) return toast('Tiene reportes abiertos. Ciérralos antes de eliminarlo.');
    if (!confirm('¿Eliminar este equipo del catálogo?')) return;
    ui.sheet = null; guarda('equipos/' + id, null); toast('Equipo eliminado');
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
  reportesEjemplo:function(){
    var eqs = lista('equipos').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
    if (eqs.length < 1) return toast('Primero da de alta equipos o carga el catálogo de ejemplo');
    var H = HR, t = now(), up = {};
    var m = [
      ['No enciende, el tablero se queda apagado.', 'fuera', 31 * H, 'nuevo', null],
      ['Pedal flojo, se mueve al pedalear.', 'normal', 26 * H, 'nuevo', null],
      ['Distorsiona el sonido.', 'normal', 9 * H, 'atencion', { diag:'Falta el cable de audio, pendiente de comprar.', compra:true, cambio:false, costo:'450' }],
      ['El soporte se mueve.', 'normal', 50 * H, 'resuelto', { diag:'Se cambió el soporte y quedó firme.', compra:false, cambio:true, costo:'', resuelto: t - 3 * H }]
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
  },
  salonesFitness:function(){
    var up = {}, n = 0;
    SALONES_FITNESS.forEach(function(f){ if (!DB.salones[f[0]]) { up['salones/' + f[0]] = { nombre: f[1], area: f[2] }; n++; } });
    if (!n) return toast('Los salones de Fitness ya están cargados');
    db.ref().update(up).then(function(){ toast('Salones de Fitness cargados'); }).catch(function(e){ toast('No se pudo cargar: ' + e.message); });
  },
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
  }
};
document.addEventListener('click', function(e){
  var b = e.target.closest('[data-a]'); if (!b) return;
  var f = A[b.getAttribute('data-a')]; if (f) f(b.getAttribute('data-v'));
});
document.addEventListener('input', function(e){
  var t = e.target;
  if (t.id === 'q') { ui.q = t.value; var p = document.getElementById('pick'); if (p) p.innerHTML = pickList(); return; }
  if (t.id === 'desc') { ui.desc = t.value; return; }
  if (t.id === 'psalon') { ui.pSalon = t.value; ui.sel = null; ui.otro = false; render(); return; }
  var f = t.getAttribute('data-f'); if (f && ui.sh) ui.sh[f] = t.type === 'checkbox' ? t.checked : t.value;
});
document.addEventListener('focusout', function(){ setTimeout(function(){ if (ui.dirty && !escribiendo()) render(); }, 150); });

initFB();
render();
setInterval(function(){ if (!escribiendo()) render(); }, 60000);   // refresca los tiempos y el rojo
