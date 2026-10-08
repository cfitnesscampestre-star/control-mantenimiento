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

var DB = { equipos: {}, salones: {}, reportes: {}, preventivo: {}, historial: {}, informes: {}, prevlog: {}, archivo: {} };
var db = null, online = false, ready = false, fbError = '';
var REQ_ACCESO = (typeof REQUIERE_ACCESO !== 'undefined') ? REQUIERE_ACCESO : false;
var FOTO_OBLIG = (typeof FOTO_DESPUES_OBLIGATORIA !== 'undefined') ? FOTO_DESPUES_OBLIGATORIA : false;
var auth = null, usuario = null, perfil = null, authListo = false, datosIniciados = false;
var SHEET_KEY = 'cm_sheet_v1', RESTAURA = null;
try { RESTAURA = JSON.parse(localStorage.getItem(SHEET_KEY) || 'null'); if (RESTAURA && now() - RESTAURA.t > 12 * 36e5) RESTAURA = null; } catch(e){ RESTAURA = null; }
function guardaSheet(){        /* recuerda el reporte abierto y lo escrito: si el teléfono recarga la app, se vuelve a abrir donde estaba */
  try {
    if (ui.sheet && ui.sheet.k === 'rep') localStorage.setItem(SHEET_KEY, JSON.stringify({ id: ui.sheet.id, sh: ui.sh, t: now() }));
    else localStorage.removeItem(SHEET_KEY);
  } catch(e){}
}
var FOT = {};      // fotos ya cargadas: FOT[idDelReporte] = { antes, despues } (viven aparte, en /fotos, para no hacer pesada la lista)

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
/* Cronómetro: "00:00:00" (con días si pasa de 24 h) y versión corta "2 h 14 min" */
function dur(ms){
  ms = Math.max(0, ms); var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s %= 86400;
  var h = Math.floor(s / 3600); s %= 3600; var m = Math.floor(s / 60); s %= 60;
  var p = function(n){ return String(n).padStart(2, '0'); };
  return (d ? d + ' d ' : '') + p(h) + ':' + p(m) + ':' + p(s);
}
function durCorta(ms){
  var m = Math.round(Math.max(0, ms) / 6e4);
  if (m < 1) return Math.round(Math.max(0, ms) / 1000) + ' s';
  if (m < 60) return m + ' min';
  var h = Math.floor(m / 60), mm = m % 60;
  return h < 48 ? h + ' h' + (mm ? ' ' + mm + ' min' : '') : Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
}
function fechaHora(ts){ return new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }); }
try { var c0 = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c0) { DB = Object.assign(DB, c0); ready = true; } } catch(e){}
function cacheSave(){ try { var c = Object.assign({}, DB); delete c.informes; delete c.archivo; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch(e){} }

/* ---------- iconos (los mismos trazos que usa Control Gerencia) ---------- */
var ICONS = {
  doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  areas:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  dash:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  next:'<path d="M9 5l7 7-7 7"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  pausa:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="M8 5l11 7-11 7z"/>',
  camara:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  logout:'<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  reloj:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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

/* ---------- fotos (antes y después) ---------- */
function cargaFotos(id){
  if (!db) return;
  db.ref('fotos/' + id).once('value').then(function(s){ FOT[id] = s.val() || {}; if (ui.sheet && ui.sheet.id === id) softRender(); }).catch(function(){ FOT[id] = FOT[id] || {}; });
}
function comprime(file, cb){          /* reduce la foto a ~1000 px y calidad media (unos 80-150 KB) para que sea ligera */
  var img = new Image(), url = URL.createObjectURL(file);
  img.onload = function(){
    var k = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); cb(c.toDataURL('image/jpeg', 0.62));
  };
  img.onerror = function(){ URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}
function guardaFoto(id, tipo, data){
  FOT[id] = Object.assign({}, FOT[id]); FOT[id][tipo] = data; softRender();
  var o = {}; o[tipo] = data;
  return db.ref('fotos/' + id).update(o).then(function(){ var f = {}; f[tipo === 'antes' ? 'fotoAntes' : 'fotoDespues'] = true; return actualiza('reportes/' + id, f); })
    .then(function(){ toast('Foto guardada'); }).catch(function(e){ toast('No se pudo guardar la foto: ' + ((e && e.message) || '')); });
}
function subeFoto(tipo, file){                 /* foto elegida de la galería o tomada con la cámara del teléfono */
  var sh = ui.sheet; if (!sh || sh.k !== 'rep' || !file) return; var id = sh.id;
  comprime(file, function(data){ if (!data) return toast('No se pudo leer la foto'); guardaFoto(id, tipo, data); });
}
/* Cámara DENTRO de la app. Al usar la cámara del teléfono, algunos celulares cierran o recargan la app mientras se toma la foto
   y se perdía la foto y el reporte abierto. Con esta cámara la app nunca se va a segundo plano. */
var cam = { stream:null, id:null, tipo:null, el:null }, camFallo = false;
function camCierra(){
  if (cam.stream) { cam.stream.getTracks().forEach(function(t){ t.stop(); }); }
  cam.stream = null; if (cam.el && cam.el.parentNode) cam.el.parentNode.removeChild(cam.el); cam.el = null;
}
function camAbre(tipo){
  var sh = ui.sheet; if (!sh || sh.k !== 'rep') return;
  if (camFallo || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return camGaleria(tipo);
  camCierra(); cam.id = sh.id; cam.tipo = tipo;
  var el = document.createElement('div'); el.className = 'cam';
  el.innerHTML = '<video autoplay playsinline muted></video><div class="cam-bar"><button class="btn" data-cam="x">Cancelar</button><button class="cam-sh" data-cam="shot" aria-label="Tomar foto"></button><button class="btn" data-cam="gal">Galería</button></div>' +
    '<div class="cam-t">' + (tipo === 'antes' ? 'Foto del ANTES' : 'Foto del DESPUÉS') + '</div>';
  document.body.appendChild(el); cam.el = el;
  navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1600 }, height:{ ideal:1200 } }, audio:false }).then(function(st){
    if (cam.el !== el) { st.getTracks().forEach(function(t){ t.stop(); }); return; }
    cam.stream = st; var v = el.querySelector('video'); v.srcObject = st; var pr = v.play && v.play(); if (pr && pr.catch) pr.catch(function(){});
  }).catch(function(){ camCierra(); camFallo = true; toast('No se pudo abrir la cámara dentro de la app. Vuelve a tocar «Tomar foto» para usar la cámara del teléfono.'); });
}
function camGaleria(tipo){ var i = document.getElementById('foto_' + tipo); if (i) i.click(); }
function camDisparo(){
  var v = cam.el && cam.el.querySelector('video'); if (!v || !v.videoWidth) return toast('Espera un momento, la cámara se está preparando');
  var k = Math.min(1, 1000 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  var data = c.toDataURL('image/jpeg', 0.62), id = cam.id, tipo = cam.tipo; camCierra();
  guardaFoto(id, tipo, data);
}
document.addEventListener('click', function(e){
  var b = e.target.closest && e.target.closest('[data-cam]'); if (!b) return;
  var a = b.getAttribute('data-cam'), tipo = cam.tipo;
  if (a === 'shot') camDisparo(); else if (a === 'x') camCierra(); else if (a === 'gal') { camCierra(); camGaleria(tipo); }
});
function fotosHTML(r){
  var f = FOT[r.id], g = f || {}, hecho = r.estado === 'resuelto';
  var bloque = function(tipo, tit, ayuda){
    var img = g[tipo];
    return '<div class="foto"><div class="foto-t"><b>' + tit + '</b>' + (img ? pill('Tomada', 'ok') : pill('Pendiente', 'mut')) + '</div>' +
      (img ? '<img src="' + img + '" alt="Foto del ' + tit.toLowerCase() + '" data-a="zoom" data-v="' + tipo + '">' : '<div class="foto-v">' + ayuda + '</div>') +
      (hecho ? '' : '<button class="btn sm foto-b" data-a="camAbre" data-v="' + tipo + '">' + ic('camara') + '<span>' + (img ? 'Cambiar foto' : 'Tomar foto') + '</span></button>' +
        '<input type="file" id="foto_' + tipo + '" accept="image/*" data-foto="' + tipo + '" hidden>') + '</div>';
  };
  return '<div class="h2 sm" style="margin:6px 0 8px">Fotos</div><div class="fotos">' +
    bloque('antes', 'Antes', 'Toma una foto de cómo está el equipo al llegar.') + bloque('despues', 'Después', 'Toma una foto cuando quede resuelto.') + '</div>' +
    (f === undefined && !hecho ? '<div class="sub" style="margin-top:-6px">Cargando fotos…</div>' : '');
}

/* ---------- archivo: lo resuelto hace más de un mes sale de la vista (pero se conserva) ----------
   Un reporte resuelto hace más de ARCHIVO_DIAS días se mueve de /reportes o /historial a /archivo. No se borra: sigue en la base y en el
   respaldo automático. Las pantallas de periodos largos (3 meses, 12 meses, Todo, fechas) lo cargan solo cuando hace falta. */
var ARCHIVO_DIAS = 30, ARCH_KEY = 'cm_archivado_v1', archCargando = false;
function cargaArchivo(){
  if (!db || DB.archivoListo || archCargando) return; archCargando = true;
  db.ref('archivo').once('value').then(function(s){ DB.archivo = s.val() || {}; DB.archivoListo = true; archCargando = false; softRender(); }).catch(function(){ archCargando = false; });
}
function archivados(){ return lista('archivo').map(function(r){ return Object.assign({}, r, { cerrada:true, archivada:true }); }); }
function archivaViejos(){
  if (!db || !usuario || !ready) return;
  var ult = 0; try { ult = +localStorage.getItem(ARCH_KEY) || 0; } catch(e){}
  if (now() - ult < 6 * 36e5) return;                      // una vez cada 6 horas por teléfono
  var corte = now() - ARCHIVO_DIAS * DAY, up = {}, n = 0;
  var revisa = function(origen){
    lista(origen).forEach(function(r){
      if (r.estado !== 'resuelto' || n >= 150) return;
      var cuando = r.resuelto || r.cerrado || 0; if (!cuando || cuando > corte) return;
      var copia = Object.assign({}, r); delete copia.id; copia.archivado = now(); copia.de = origen;
      up['archivo/' + r.id] = copia; up[origen + '/' + r.id] = null; n++;
    });
  };
  revisa('reportes'); revisa('historial');
  try { localStorage.setItem(ARCH_KEY, String(now())); } catch(e){}
  if (!n) return;
  db.ref().update(up).then(function(){ toast(plu(n, 'reporte resuelto hace más de un mes pasó', 'reportes resueltos hace más de un mes pasaron') + ' al archivo (no se borró).'); })
    .catch(function(e){ console.warn('Archivo: no se pudo mover (¿ya publicaste las reglas nuevas de Firebase?)', e && e.message); });
}
function descargaJSON(nombre, obj){
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type:'application/json' })); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function respaldoManual(conFotos){
  if (!db) return toast('Sin conexión con la base de datos');
  toast('Preparando el respaldo…');
  var nodos = ['salones', 'equipos', 'reportes', 'historial', 'archivo', 'preventivo', 'prevlog', 'informes', 'usuarios'].concat(conFotos ? ['fotos'] : []), out = {};
  Promise.all(nodos.map(function(n){ return db.ref(n).once('value').then(function(s){ out[n] = s.val(); }); })).then(function(){
    descargaJSON('respaldo-mantenimiento-' + fechaInput(now()) + (conFotos ? '-con-fotos' : '') + '.json', out); toast('Respaldo descargado');
  }).catch(function(e){ toast('No se pudo hacer el respaldo: ' + ((e && e.message) || '')); });
}

/* ---------- Firebase ---------- */
function iniciaDatos(){
  if (datosIniciados) return; datosIniciados = true;
  ['equipos', 'salones', 'reportes', 'preventivo'].forEach(function(k){
    db.ref(k).on('value', function(s){ DB[k] = s.val() || {}; ready = true; fbError = ''; cacheSave(); softRender(); },
      function(err){ fbError = 'Firebase: ' + err.message; softRender(); });
  });
  db.ref('historial').limitToLast(200).on('value', function(s){ DB.historial = s.val() || {}; cacheSave(); softRender(); }, function(){});
  db.ref('prevlog').limitToLast(400).on('value', function(s){ DB.prevlog = s.val() || {}; cacheSave(); softRender(); }, function(){});
  db.ref('informes').limitToLast(30).on('value', function(s){ DB.informes = s.val() || {}; softRender(); }, function(){});
}
function cargaPerfil(u){
  db.ref('usuarios/' + u.uid).once('value').then(function(s){
    perfil = s.val() || null;
    if (!perfil || !perfil.nombre) { ui.sheet = { k:'nombre' }; ui.sh = { nombre:'' }; }
    render();
  }).catch(function(){ render(); });
}
function initFB(){
  try {
    if (typeof firebase === 'undefined') throw new Error('No se pudo cargar Firebase. Abre la app una vez con internet.');
    firebase.initializeApp(FIREBASE_MANT);
    db = firebase.database();
    db.ref('.info/connected').on('value', function(s){ online = !!s.val(); softRender(); });
    if (REQ_ACCESO) {
      if (!firebase.auth) throw new Error('No se pudo cargar el acceso. Abre la app una vez con internet.');
      auth = firebase.auth();
      auth.onAuthStateChanged(function(u){
        usuario = u; authListo = true;
        if (u) { iniciaDatos(); cargaPerfil(u); } else { perfil = null; ui.sheet = null; }
        render();
      });
    } else { authListo = true; iniciaDatos(); }
  } catch (e) { fbError = e.message; authListo = true; }
}
function nombreTec(){ return (perfil && perfil.nombre) || (usuario && usuario.email ? usuario.email.split('@')[0] : 'Técnico'); }
function msgAuth(e){
  var c = (e && e.code) || '';
  if (/user-not-found|wrong-password|invalid-credential|invalid-email|invalid-login/.test(c)) return 'Usuario o PIN incorrecto.';
  if (/too-many/.test(c)) return 'Demasiados intentos. Espera unos minutos.';
  if (/network/.test(c)) return 'Sin internet. Revisa tu conexión.';
  if (/operation-not-allowed|configuration-not-found/.test(c)) return 'Falta activar el acceso con correo y contraseña en Firebase.';
  return 'No se pudo entrar: ' + ((e && e.message) || c);
}
function loginHTML(){
  var logo = '<div class="lg-logo"><img src="img/logo.png" alt="Mantenimiento Deportivo" data-fallback></div>';
  if (!authListo) return '<div class="login"><div class="login-card"><div class="lg-brand">' + logo + '<div class="lg-title"><p>Club Campestre</p><h1>Cargando…</h1></div></div></div></div>';
  return '<div class="login"><div class="login-card"><div class="lg-brand">' + logo + '<div class="lg-title"><p>Club Campestre</p><h1>Control Mantenimiento</h1></div></div>' +
    '<label class="lg-lbl" for="lg_u">Usuario</label><input id="lg_u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Ej. tecnico" value="' + esc(ui.lgU || '') + '">' +
    '<label class="lg-lbl" for="lg_p">PIN</label><input id="lg_p" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Tu PIN">' +
    (ui.lgErr ? '<div class="lgerr" role="alert">' + esc(ui.lgErr) + '</div>' : '') +
    '<button class="btn cta block" style="margin-top:14px" data-a="entrar"' + (ui.lgBusy ? ' disabled' : '') + '>' + (ui.lgBusy ? 'Entrando…' : 'Entrar') + '</button>' +
    '<div class="lg-help">' + (window.VISTA_PREVIA ? 'Vista previa: escribe cualquier usuario y PIN.' : 'Si olvidaste tu PIN, pide que lo restablezcan en Firebase.') + '</div></div></div>';
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
var ui = { tab:'reportes', estado:null, urg:null, urgAbre:false, reset:false, per:{ t:'pend' }, carrPausa:!!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), areaF:'Todos', sh:null, sheet:null, dirty:false };

/* ---------- datos derivados ---------- */
/* ---------- códigos QR de equipos ----------
   El QR lleva el enlace de esta app con ?eq=<id del equipo>. Control Fitness lo lee con la cámara y llena solo el equipo
   (nombre y foto); si alguien lo abre con la cámara normal del teléfono, llega aquí y ve la ficha del equipo. */
var EQ_LINK = (location.search.match(/[?&]eq=([^&#]+)/) || [])[1] || null;
function qrUrl(id){ return location.origin + location.pathname.replace(/[^\/]*$/, '') + '?eq=' + encodeURIComponent(id); }
function qrSvg(id){
  if (typeof qrcode !== 'function') return '';
  var q = qrcode(0, 'M'); q.addData(qrUrl(id)); q.make();
  return q.createSvgTag(4, 8).replace(/ width="[^"]*" height="[^"]*"/, ' width="100%" height="100%"');
}
function imprimeEtiquetas(ids){
  if (!ids.length) return toast('No hay equipos para imprimir');
  var items = ids.map(function(id){ var e = eqById(id); return '<div class="et">' + qrSvg(id) + '<b>' + esc(e.nombre) + '</b><small>' + esc(eqLugar(e)) + '</small></div>'; }).join('');
  var html = '<!doctype html><html><head><meta charset="utf-8"><title>Códigos QR de equipos</title><style>@page{margin:10mm}body{font-family:Arial,Helvetica,sans-serif;margin:0}' +
    '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.et{border:1px dashed #999;border-radius:3mm;padding:4mm;text-align:center;break-inside:avoid}' +
    '.et svg{width:42mm;height:42mm}.et b{display:block;font-size:11pt;margin-top:2mm}.et small{display:block;font-size:9pt;color:#555;margin-top:1mm}</style></head><body><div class="g">' + items + '</div></body></html>';
  var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
  var d = f.contentWindow.document; d.open(); d.write(html); d.close();
  setTimeout(function(){ try { f.contentWindow.focus(); f.contentWindow.print(); } catch(e){ toast('No se pudo abrir la impresión'); } setTimeout(function(){ if (f.parentNode) f.parentNode.removeChild(f); }, 60000); }, 400);
}
function eqById(id){ return Object.assign({ id: id, nombre:'Equipo (eliminado)', salonId:'', foto:'' }, (DB.equipos || {})[id] || {}); }
function salonById(id){ return Object.assign({ id: id, nombre:'—', area:'' }, (DB.salones || {})[id] || {}); }
function eqLugar(e){ return salonById(e.salonId).nombre; }
function eqArea(e){ return salonById(e.salonId).area; }
function abiertos(){ return lista('reportes'); }
/* Lo que ve Control Gerencia: reportes de Fitness (origen fitness o profId numérico) y de los profesores de Gerencia (origen gerencia + areaId). Los de prueba no cuentan. */
function esGerencia(r){ return !esPrueba(r) && (esFitness(r) || (r.origen === 'gerencia' && !!r.areaId)); }
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

/* ---------- periodo (barra y calendario) ---------- */
function addDias(ts, n){ var d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
function finDia(ts){ var d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }
function fCorta(ts){ return new Date(ts).toLocaleDateString('es-MX', { day:'numeric', month:'short' }).replace('.', ''); }
/* Sin periodo ("pend") se ven los pendientes de resolver. Con periodo se ven todos los reportes que llegaron en esas fechas
   (abiertos y ya cerrados), y después se filtra por estado. */
function rangoPer(){
  var p = ui.per; if (p.t === 'pend') return null;
  var hoy = sod(now()), d, h = finDia(hoy);
  if (p.t === 'hoy') d = hoy; else if (p.t === '7') d = addDias(hoy, -6); else if (p.t === '30') d = addDias(hoy, -29);
  else if (p.t === '90') d = addDias(hoy, -89); else if (p.t === '365') d = addDias(hoy, -364);
  else if (p.t === 'mes') { var m = new Date(hoy); m.setDate(1); d = m.getTime(); }
  else if (p.t === 'all') d = 0;
  else { d = new Date(p.desde + 'T00:00:00').getTime(); h = finDia(new Date(p.hasta + 'T00:00:00').getTime()); }
  return { desde:d, hasta:h };
}
function setPeriodo(R){
  var cerrados = lista('historial').map(function(r){ return Object.assign({}, r, { cerrada:true }); });
  if (R.desde < now() - ARCHIVO_DIAS * DAY) { cargaArchivo(); cerrados = cerrados.concat(archivados()); }
  return abiertos().concat(cerrados).filter(function(r){ return r.creado >= R.desde && r.creado <= R.hasta; });
}
function barraPeriodo(R, total){
  var t, nombres = { hoy:'Hoy', '7':'Últimos 7 días', '30':'Últimos 30 días', '90':'Últimos 3 meses', '365':'Últimos 12 meses', mes:'Este mes', all:'Todo el historial' };
  if (!R) t = ['Hoy · ' + fechaTxt(sod(now())), 'Pendientes de resolver'];
  else {
    var rango = ui.per.t === 'all' ? 'Desde el primer reporte' : ui.per.t === 'hoy' ? fechaTxt(R.desde) : fCorta(R.desde) + ' – ' + fCorta(R.hasta) + ' ' + new Date(R.hasta).getFullYear();
    t = [ui.per.t === 'custom' ? rango : nombres[ui.per.t] + ' · ' + rango, plu(total, 'reporte', 'reportes') + ' en el periodo'];
  }
  return '<div class="ch2-per"><div class="ch2-pt"><b>' + esc(t[0]) + '</b><small>' + esc(t[1]) + '</small></div><div class="ch2-btns">' +
    (R ? '<button class="btn sm" data-a="perRapido" data-v="pend">Pendientes</button>' : '') +
    '<button class="ch2-cal" data-a="calAbre" aria-label="Elegir el periodo">' + ic('cal') + '<span>Fechas</span></button></div></div>';
}

/* ---------- piezas de pantalla ---------- */
function pillEstado(r){
  return r.estado === 'resuelto' ? pill('Resuelto', 'ok big') : r.estado === 'atencion' ? pill('En proceso', 'warn big') : pill('Sin atender', 'bad big');
}
function pillUrg(r){
  return r.urg === 'fuera' ? pill('No se puede usar', 'u-fuera') : r.urg === 'urgente' ? pill('Urgente', 'u-urg') : pill('Normal', 'mut');
}
/* Cronómetro de un reporte: corre desde que llega y se detiene al resolverse. Sirve de base para el control de tiempos. */
function timerHTML(r){
  var fin = r.estado === 'resuelto' ? (r.resuelto || now()) : 0;
  return '<div class="rep-time">' + ic('reloj') + '<span>' + (fin ? 'Resuelto en' : 'Tiempo desde que llegó') + '</span><b class="timer' + (fin ? ' stop' : '') + '" data-t0="' + r.creado + '">' + dur((fin || now()) - r.creado) + '</b></div>';
}
function tick(){ var n = now(); document.querySelectorAll('.timer[data-t0]:not(.stop)').forEach(function(el){ el.textContent = dur(n - (+el.getAttribute('data-t0'))); }); }
function repCard(r, abre){
  var e = eqById(r.equipoId), x = [];
  if (r.otroLugar) x.push('<small><b>Reportado desde otro salón</b></small>');
  if (r.cerrada) x.push('<small>El instructor ya cerró este aviso</small>');
  if (r.tecnico && r.estado !== 'nuevo') x.push('<small>Atiende: ' + esc(r.tecnico) + '</small>');
  if (r.fotoAntes || r.fotoDespues) x.push('<small>Fotos: antes ' + (r.fotoAntes ? '✓' : '—') + ' · después ' + (r.fotoDespues ? '✓' : '—') + '</small>');
  var espP = arr(r.piezas).filter(function(p){ return !p.llego; })[0];
  if (espP) x.push('<small><b>Esperando pieza:</b> ' + esc(espP.desc) + ' · desde ' + fechaHora(espP.pedida) + '</small>');
  if (r.diag) x.push('<small><b>Diagnóstico:</b> ' + esc(r.diag) + '</small>');
  if (r.compra || r.cambio) x.push('<small>' + (r.compra ? 'Requiere compra' : '') + (r.compra && r.cambio ? ' · ' : '') + (r.cambio ? 'Requiere cambio' : '') + (r.costo ? ' · estimado $' + esc(r.costo) : '') + '</small>');
  var inner = '<div class="rep-h">' + pillEstado(r) + pillUrg(r) + (abre ? '<span class="go">' + ic('next') + '</span>' : '') + '</div>' +
    '<b class="rep-t">' + esc(e.nombre) + '</b><span class="rep-d">' + esc(r.desc) + '</span>' +
    '<small>' + esc(eqLugar(e)) + ' · ' + esc(r.prof || 'Instructor') + (r.origen === 'gerencia' && r.area ? ' · ' + esc(r.area) : '') + (r.clase ? ' · ' + esc(r.clase) : '') + ' · llegó ' + fechaHora(r.creado) + '</small>' +
    (x.length ? '<div class="rep-x">' + x.join('') + '</div>' : '') + timerHTML(r);
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
    '<div class="stack"><button class="btn primary" data-a="salonesFitness">Cargar los salones de Fitness</button><button class="btn" data-a="salones">Dar de alta salones a mano</button></div></div>';
}
/* ---------- inventario real de Spinning ---------- */
function nrm(t){ return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function salonSpinningId(){
  var hit = lista('salones').filter(function(x){ return nrm(x.nombre).indexOf('spinning') >= 0; })[0];
  return hit ? hit.id : 'salon-spinning';
}
function invFaltan(){ return (typeof INVENTARIO_SPINNING !== 'undefined' ? INVENTARIO_SPINNING : []).filter(function(x){ return !(DB.equipos || {})[x.id]; }); }
function esPrueba(r){ return r.profId === 'ejemplo' || r.profId === 'prueba'; }
/* lo ficticio que pudo quedar de las pruebas: equipos y revisiones de ejemplo, y los reportes hechos sobre ellos */
function ejemplos(){
  var eq = lista('equipos').filter(function(e){ return e.ejemplo; }), ids = {}; eq.forEach(function(e){ ids[e.id] = 1; });
  var rep = lista('reportes').filter(function(r){ return esPrueba(r) || ids[r.equipoId]; });
  var his = lista('historial').filter(function(r){ return esPrueba(r) || ids[r.equipoId]; });
  return { eq:eq, prev:lista('preventivo').filter(function(p){ return p.ejemplo; }), rep:rep, his:his, n: eq.length + rep.length + his.length };
}
function inventarioCard(){
  var falta = invFaltan(), ej = ejemplos();
  if (!falta.length && !ej.n) return '';
  var tot = typeof INVENTARIO_SPINNING !== 'undefined' ? INVENTARIO_SPINNING.length : 0;
  return '<div class="card"><div class="h2 sm" style="margin-top:0">Inventario real del Salón de Spinning</div>' +
    '<div class="sub" style="margin:0 0 10px">' + (falta.length ? 'Trae las ' + tot + ' bicicletas del levantamiento, cada una con su foto, hallazgo y corrección requerida.' : 'El inventario de Spinning ya está cargado.') +
    (ej.n ? ' También quita los datos de ejemplo que quedaron de las pruebas (' + plu(ej.eq.length, 'equipo', 'equipos') + ', ' + plu(ej.rep.length + ej.his.length, 'reporte', 'reportes') + '). No toca los salones.' : '') + '</div>' +
    '<button class="btn primary block" data-a="invCarga">' + (falta.length ? 'Cargar inventario de Spinning' : 'Quitar datos de ejemplo') + '</button></div>';
}
function vReportes(){
  var R = rangoPer(), base = R ? setPeriodo(R) : abiertos(), cnt = { nuevo:0, atencion:0, resuelto:0 };
  base.forEach(function(r){ cnt[r.estado] = (cnt[r.estado] || 0) + 1; });
  var l = base.filter(function(r){ return ui.estado ? r.estado === ui.estado : (R ? true : r.estado !== 'resuelto'); });
  if (ui.urg) l = l.filter(function(r){ return r.urg === ui.urg; });
  l.sort(function(a, b){
    var ga = a.estado === 'resuelto' ? 1 : 0, gb = b.estado === 'resuelto' ? 1 : 0;
    return ga !== gb ? ga - gb : ga ? (b.resuelto || 0) - (a.resuelto || 0) : a.creado - b.creado;
  });
  var titulo = ui.estado === 'nuevo' ? 'No visto' : ui.estado === 'atencion' ? 'En proceso' : ui.estado === 'resuelto' ? 'Resueltos' : R ? 'Todos los reportes' : 'Sin resolver';
  var orden = R ? plu(l.length, 'reporte', 'reportes') + ' · pendientes primero' : ui.estado === 'resuelto' ? 'Los más recientes primero' : 'El que lleva más tiempo, primero';
  var sts = [['nuevo', 'rojo', 'No visto'], ['atencion', 'amar', 'En proceso'], ['resuelto', 'verde', 'Resuelto']];
  var urgBarra = '<div class="urgf"><button class="chip' + (ui.urg ? ' on' : '') + '" data-a="urgAbre" aria-expanded="' + ui.urgAbre + '">Urgencia' + (ui.urg ? ': ' + URG_TXT[ui.urg] : '') + (ui.urgAbre ? ' ▴' : ' ▾') + '</button>' +
      '<button class="chip' + (ui.urg ? '' : ' on') + '" data-a="urgTodos" aria-pressed="' + !ui.urg + '">Todos</button></div>' +
    (ui.urgAbre ? '<div class="chips">' + [['fuera', 'No se puede usar'], ['urgente', 'Urgente'], ['normal', 'Normal']].map(function(f){
      return '<button class="chip' + (ui.urg === f[0] ? ' on' : '') + '" data-a="urg" data-v="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>' : '');
  return empiezaAqui() + barraPeriodo(R, base.length) + urgBarra +
    '<div class="carr-nav"><div><b>' + titulo + '</b><small>' + orden + '</small></div>' +
      (l.length ? '<div class="carr-ctl"><span id="carr-n">1 de ' + l.length + '</span>' +
        (l.length > 1 ? '<button class="ibtn" data-a="carrPausa" aria-label="' + (ui.carrPausa ? 'Reanudar el carrusel' : 'Pausar el carrusel') + '">' + ic(ui.carrPausa ? 'play' : 'pausa') + '</button>' : '') +
        '<button class="ibtn" data-a="carr" data-v="-1" aria-label="Anterior">' + ic('back') + '</button><button class="ibtn" data-a="carr" data-v="1" aria-label="Siguiente">' + ic('next') + '</button></div>' : '') + '</div>' +
    (l.length ? '<div class="carr">' + l.map(function(r){ return repCard(r, !r.cerrada); }).join('') + '</div>'
              : empty(ready ? (R ? 'No hay reportes en este periodo' + (ui.estado ? ' con ese estado.' : '.') : ui.estado ? 'No hay reportes en este estado.' : 'No hay reportes sin resolver. Todo en orden.') : 'Cargando…')) +
    '<div class="sts">' + sts.map(function(x){
      return '<button class="stb ' + x[1] + (ui.estado === x[0] ? ' on' : '') + '" data-a="estado" data-v="' + x[0] + '" aria-pressed="' + (ui.estado === x[0]) + '"><b>' + (cnt[x[0]] || 0) + '</b><span>' + x[2] + '</span></button>';
    }).join('') + '</div>';
}
/* ---------- recorrido preventivo por salón ----------
   El técnico elige el salón del día y ve sus equipos con foto. ROJO = tiene un reporte sin resolver (va primero) o le toca su
   revisión preventiva; VERDE = al corriente. Al revisarlo se guarda la fecha y vuelve a salirle hasta que se cumpla la frecuencia
   del salón (equipos/{id}.prevUlt, salones/{id}.prevFreq, bitácora en /prevlog). */
var PREV_FREQ_DEF = 30;
function prevFreqSalon(sid){ return +(salonById(sid).prevFreq) || PREV_FREQ_DEF; }
function eqPrev(e){
  var reps = abiertos().filter(function(r){ return r.equipoId === e.id && r.estado !== 'resuelto'; }).sort(sortRep), t = now();
  if (reps.length) {
    var fuera = reps.some(function(r){ return r.urg === 'fuera'; }), nuevo = reps.some(function(r){ return r.estado === 'nuevo'; });
    return { c:'rojo', rep:reps, orden:0, t: fuera ? 'Fuera de servicio' : nuevo ? 'Reporte sin atender' : 'Reporte en proceso' };
  }
  var fr = prevFreqSalon(e.salonId), vence = e.prevUlt ? e.prevUlt + fr * DAY : 0;
  if (e.prevPosp && e.prevPosp > t) return { c:'amar', rep:[], orden:2, t:'Pospuesto al ' + fCorta(e.prevPosp) };
  if (!e.prevUlt) return { c:'rojo', rep:[], orden:1, t:'Sin revisión preventiva' };
  if (t >= vence) return { c:'rojo', rep:[], orden:1, t:'Preventivo vencido', sub:'Última: ' + hace(e.prevUlt) };
  return { c:'verde', rep:[], orden:3, t:'Revisado ' + hace(e.prevUlt) };
}
function salonResumen(sid){
  var eqs = lista('equipos').filter(function(e){ return e.salonId === sid; }), n = { rojo:0, amar:0, verde:0, rep:0 };
  eqs.forEach(function(e){ var p = eqPrev(e); n[p.c]++; if (p.rep.length) n.rep++; });
  return { total:eqs.length, rojo:n.rojo, amar:n.amar, verde:n.verde, rep:n.rep };
}
function vRecorrido(sid){
  var sal = salonById(sid), eqs = lista('equipos').filter(function(e){ return e.salonId === sid; }).map(function(e){ return { e:e, p:eqPrev(e) }; });
  eqs.sort(function(a, b){ return a.p.orden - b.p.orden || a.e.nombre.localeCompare(b.e.nombre, 'es', { numeric:true }); });
  var R = salonResumen(sid), hechos = R.verde + R.amar, pct = R.total ? Math.round(hechos * 100 / R.total) : 0;
  var l = ui.prevSolo ? eqs.filter(function(x){ return x.p.c === 'rojo'; }) : eqs;
  var fr = [[7, 'Cada semana'], [15, 'Cada 15 días'], [30, 'Cada mes'], [60, 'Cada 2 meses'], [90, 'Cada 3 meses']], f0 = prevFreqSalon(sid);
  return '<div class="btns" style="margin-top:0"><button class="btn" data-a="prevSalon" data-v="">' + ic('back') + ' Salones</button></div>' +
    '<div class="card"><div class="h2 sm" style="margin:0 0 4px">' + esc(sal.nombre) + '</div>' +
    '<div class="sub" style="margin:0 0 8px">' + (R.rojo ? '<b class="bad">' + plu(R.rojo, 'equipo por atender', 'equipos por atender') + '</b>' + (R.rep ? ' · ' + plu(R.rep, 'con reporte', 'con reporte') : '') : '<b class="ok">Todo el salón está al corriente</b>') + ' · ' + R.verde + ' de ' + R.total + ' en verde</div>' +
    '<div class="prog"><i style="width:' + pct + '%"></i></div>' +
    '<div class="two" style="margin-top:10px"><label class="f" style="margin:0"><span>Revisar este salón</span><select data-a-change="prevFreq">' + fr.map(function(x){ return '<option value="' + x[0] + '"' + (f0 === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
    '<div style="display:flex;align-items:flex-end"><button class="chip' + (ui.prevSolo ? ' on' : '') + '" style="width:100%;justify-content:center" data-a="prevSolo">' + (ui.prevSolo ? 'Viendo solo los rojos' : 'Ver solo los rojos') + '</button></div></div></div>' +
    (l.length ? '<div class="eqgrid" style="margin-top:12px">' + l.map(function(x){
      var e = x.e, p = x.p;
      return '<button class="eq ' + p.c + '" data-a="prevEq" data-v="' + e.id + '"><div class="pic">' + ic('img') + (e.foto ? esc(e.foto) + '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</div>' +
        '<div class="inf"><b>' + esc(e.nombre) + '</b>' + pill(p.t, p.c === 'rojo' ? 'bad' : p.c === 'amar' ? 'warn' : 'ok') + (p.sub ? '<small>' + esc(p.sub) + '</small>' : '') + '</div></button>';
    }).join('') + '</div>' : empty(eqs.length ? 'No hay equipos en rojo en este salón.' : 'Este salón todavía no tiene equipos. Dalos de alta en la pestaña Equipos.'));
}
function vPreventivo(){
  if (ui.prevSalon && DB.salones[ui.prevSalon]) return vRecorrido(ui.prevSalon);
  var sal = lista('salones').filter(function(x){ return lista('equipos').some(function(e){ return e.salonId === x.id; }); }).map(function(x){ return { s:x, r:salonResumen(x.id) }; })
    .sort(function(a, b){ return (b.r.rep - a.r.rep) || (b.r.rojo - a.r.rojo) || a.s.nombre.localeCompare(b.s.nombre, 'es', { numeric:true }); });
  var l = lista('preventivo').sort(function(a, b){ return a.proxima - b.proxima; });
  var ven = l.filter(function(p){ return diasPrev(p) < 0; }), hoy = l.filter(function(p){ return diasPrev(p) === 0; }), prox = l.filter(function(p){ return diasPrev(p) > 0; });
  var grid = function(x){ return '<div class="replist">' + x.map(function(p){ return prevCard(p); }).join('') + '</div>'; };
  return '<div class="sub">' + esc(fechaTxt(sod(now()))) + '</div><div class="h2 sm" style="margin-top:2px">Recorrido por salón</div>' +
    '<div class="sub" style="margin-top:-4px">Elige el salón de hoy. Los equipos en rojo son los que necesitan atención: primero los que tienen reporte, luego los que les toca su revisión.</div>' +
    (sal.length ? '<div class="salgrid">' + sal.map(function(x){
      var r = x.r, c = r.rojo ? 'rojo' : 'verde', pct = r.total ? Math.round((r.verde + r.amar) * 100 / r.total) : 0;
      return '<button class="salc ' + c + '" data-a="prevSalon" data-v="' + x.s.id + '"><div class="salc-h"><b>' + esc(x.s.nombre) + '</b>' + (r.rojo ? pill(r.rojo + ' en rojo', 'bad big') : pill('Al corriente', 'ok big')) + '</div>' +
        '<small>' + (r.rep ? '<b>' + plu(r.rep, 'equipo con reporte', 'equipos con reporte') + '</b> · ' : '') + r.verde + ' de ' + r.total + ' en verde</small><div class="prog"><i style="width:' + pct + '%"></i></div></button>';
    }).join('') + '</div>' : empty('Todavía no hay equipos dados de alta. Entra a Equipos para cargarlos por salón.')) +
    '<div class="h2 sm">Revisiones programadas</div><div class="btns" style="margin-top:0;margin-bottom:6px"><button class="btn primary" data-a="prevNew">' + ic('plus') + ' Agregar revisión</button></div>' +
    (!l.length ? empty('No hay revisiones programadas aparte del recorrido. Sirven para tareas generales (por ejemplo, “fumigar”).') : '') +
    (ven.length ? '<div class="h2 sm"><span class="bad">Vencido · ' + ven.length + '</span></div>' + grid(ven) : '') +
    (l.length ? '<div class="h2 sm">Para hoy · ' + hoy.length + '</div>' + (hoy.length ? grid(hoy) : empty('Nada más para hoy.')) +
      '<div class="h2 sm">Próximos</div>' + (prox.length ? grid(prox) : empty('No hay preventivos próximos.')) : '');
}
function vEquipos(){
  var eqs = lista('equipos').sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); });
  var areas = ['Todos'].concat(eqs.map(function(e){ return eqArea(e); }).filter(function(a, i, ar){ return a && ar.indexOf(a) === i; }));
  var l = eqs.filter(function(e){ return ui.areaF === 'Todos' || eqArea(e) === ui.areaF; });
  return '<div class="btns" style="margin-top:0"><button class="btn primary" data-a="eqNew">' + ic('plus') + ' Agregar equipo</button><button class="btn" data-a="impAbre">Importar equipos</button><button class="btn" data-a="salones">Salones</button><button class="btn" data-a="qrAll">Imprimir QR</button></div>' + inventarioCard() + empiezaAqui() +
    (areas.length > 1 ? '<div class="chips">' + areas.map(function(a){ return '<button class="chip' + (ui.areaF === a ? ' on' : '') + '" data-a="areaF" data-v="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div>' : '') +
    (l.length ? '<div class="eqgrid">' + l.map(function(e){
      var s = eqEstado(e.id);
      return '<button class="eq" data-a="eqOpen" data-v="' + e.id + '"><div class="pic">' + ic('img') + (e.foto ? esc(e.foto) + '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</div>' +
        '<div class="inf"><b>' + esc(e.nombre) + '</b><small>' + esc(eqLugar(e)) + '</small>' + pill(s.t, s.c) + '</div></button>';
    }).join('') + '</div>' : empty('No hay equipos en esta lista.'));
}
/* Reportes gerencia: lo mismo que ve Control Gerencia (reportes de Fitness y de los profesores de Gerencia) */
function vGerencia(){
  if (ui.inf) return vInforme();
  var ab = abiertos().filter(esGerencia).sort(sortRep), pv = lista('preventivo');
  var sin = ab.filter(function(r){ return r.estado === 'nuevo'; }), pro = ab.filter(function(r){ return r.estado === 'atencion'; });
  var atend = infReps(infCfg(INF_RAP.res.o)).length;
  var ven = pv.filter(function(p){ return diasPrev(p) < 0; });
  var pospN = pv.reduce(function(n, p){ return n + arr(p.posp).length; }, 0);
  var compras = ab.filter(function(r){ return (r.compra || r.cambio) && r.estado !== 'resuelto'; });
  var total = compras.reduce(function(n, r){ return n + (parseFloat(r.costo) || 0); }, 0);
  return '<div class="vinc"><b>Esto es lo que ve Control Gerencia</b><span>Cuentan los reportes de instructores de Fitness y de los profesores de las áreas de Gerencia; los de ejemplo no se incluyen. Toca un indicador para ver su lista.</span></div>' +
    '<div class="kpis k3">' + infKpiBtn('sin', 'Sin atender', sin.length, sin.length ? 'problemas en rojo' : 'sin problemas', { cls: sin.length ? 'bad' : 'ok', color: 'var(--bad)' }) +
      infKpiBtn('pro', 'En proceso', pro.length, 'ya los vio mantenimiento', { cls: pro.length ? 'warn' : '', color: 'var(--warn)' }) +
      infKpiBtn('res', 'Atendidos', atend, 'resueltos en 30 días', { cls: 'ok', color: 'var(--ok)' }) + '</div>' +
    '<div class="kpis k3">' + infKpiBtn('ven', 'Preventivos vencidos', ven.length, ven.length ? 'revisión atrasada' : 'al corriente', { cls: ven.length ? 'bad' : 'ok', color: 'var(--bad)' }) +
      infKpiBtn('posp', 'Pospuestos', pospN, 'veces que se movió una revisión', { color: 'var(--b3)' }) +
      infKpiBtn('compras', 'Compras o cambios', compras.length, total ? 'estimado $' + total.toLocaleString('es-MX') : 'por autorizar', { color: 'var(--b2)' }) + '</div>' +
    infGeneradorHTML() + infEnviadosHTML() + respaldoCard();
}

function respaldoCard(){
  return '<div class="card" style="margin-top:14px"><div class="h2 sm" style="margin:0 0 4px">Respaldo de la información</div>' +
    '<div class="sub" style="margin:0 0 10px">Los reportes resueltos hace más de ' + ARCHIVO_DIAS + ' días salen de la vista y pasan al archivo, pero no se borran. Además, GitHub guarda un respaldo automático cada día (ver LEEME). Aquí puedes bajar una copia a mano.</div>' +
    '<div class="btns" style="margin-top:0"><button class="btn" data-a="respaldo">Descargar respaldo (sin fotos)</button><button class="btn" data-a="respaldoFotos">Con fotos</button></div></div>';
}

/* ---------- hojas (ventana emergente, igual que en Gerencia) ---------- */
function mHead(t){ return '<div class="sh-h"><b>' + esc(t) + '</b><button class="ibtn" data-a="close" aria-label="Cerrar">' + ic('x') + '</button></div>'; }
function opcionesSalon(sel, vacio){
  return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista('salones').map(function(s){ return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.nombre) + ' · ' + esc(s.area) + '</option>'; }).join('');
}
function esperaPz(r){ return arr(r.piezas).some(function(x){ return !x.llego; }); }
function msPiezas(r, hasta){                 /* tiempo total esperando piezas (lo que sigue pendiente cuenta hasta "hasta") */
  return arr(r.piezas).reduce(function(n, x){ return n + Math.max(0, (x.llego || hasta) - x.pedida); }, 0);
}
function tiemposHTML(r){
  var fila = function(t, v){ return '<div class="row"><div><b>' + t + '</b><small>' + v + '</small></div></div>'; };
  var fin = r.estado === 'resuelto' ? (r.resuelto || now()) : now(), pz = arr(r.piezas);
  var h = '<div class="card" style="margin-bottom:14px"><div class="h2 sm" style="margin:0 0 8px">Tiempos</div>' +
    fila('Llegó', fechaHora(r.creado)) +
    (r.tecnico ? fila('Atiende', esc(r.tecnico)) : '') +
    fila('Lo abrió mantenimiento', r.visto ? fechaHora(r.visto) + ' · tardó ' + durCorta(r.visto - r.creado) : 'Todavía no');
  pz.forEach(function(x){
    h += fila('Pidió pieza: ' + esc(x.desc), fechaHora(x.pedida) + ' · ' + durCorta(x.pedida - (r.visto || r.creado)) + ' después de abrirlo');
    h += fila(x.llego ? 'Llegó la pieza' : 'Esperando la pieza', x.llego ? fechaHora(x.llego) + ' · esperó ' + durCorta(x.llego - x.pedida) : 'lleva ' + durCorta(now() - x.pedida));
  });
  if (pz.length) { var mp = msPiezas(r, fin); h += fila('Total esperando piezas', durCorta(mp)); }
  if (r.estado === 'resuelto') {
    var tot = (r.resuelto || now()) - (r.visto || r.creado), mp2 = msPiezas(r, r.resuelto || now());
    h += fila('Resuelto', fechaHora(r.resuelto || now()) + ' · en proceso ' + durCorta(tot) + (mp2 ? ' (de eso, ' + durCorta(mp2) + ' esperando piezas; trabajo ' + durCorta(Math.max(0, tot - mp2)) + ')' : ''));
  }
  return h + '</div>';
}
function piezaHTML(r, sh, hecho){
  if (hecho) return '';
  var pz = arr(r.piezas), esp = pz.filter(function(x){ return !x.llego; })[0];
  if (esp) {
    return '<div class="card pieza esp" style="margin-bottom:14px"><div class="h2 sm" style="margin:0 0 6px">Esperando pieza</div>' +
      '<b>' + esc(esp.desc) + '</b><small class="mut" style="display:block">Pedida ' + fechaHora(esp.pedida) + '</small>' +
      '<div class="rep-time" style="margin-top:8px;border:0;padding-top:0">' + ic('reloj') + '<span>Lleva esperando</span><b class="timer" data-t0="' + esp.pedida + '">' + dur(now() - esp.pedida) + '</b></div>' +
      '<button class="btn primary block" style="margin-top:10px" data-a="piezaLlego">Ya llegó la pieza (seguir con el trabajo)</button></div>';
  }
  return '<div class="card pieza" style="margin-bottom:14px"><div class="h2 sm" style="margin:0 0 6px">¿Hace falta una pieza?</div>' +
    '<label class="f" style="margin-bottom:8px"><span>Qué pieza o material se necesita</span><input data-f="pieza" placeholder="Ej. Pedal izquierdo" value="' + esc(sh.pieza || '') + '"></label>' +
    '<button class="btn block" data-a="piezaPide">Pedir pieza (marca la hora)</button>' +
    '<small class="mut" style="display:block;margin-top:6px">Se guarda la hora en que la pediste y cuánto tarda en llegar. Aparece en “Compras o cambios”.</small></div>';
}
function sheetCal(){
  var hoy = fechaInput(sod(now())), q = [['pend', 'Pendientes'], ['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['90', '3 meses'], ['365', '12 meses'], ['mes', 'Este mes'], ['all', 'Todo']];
  return mHead('Elegir periodo') +
    '<div class="chips" style="margin-bottom:10px">' + q.map(function(x){ return '<button class="chip' + (ui.per.t === x[0] ? ' on' : '') + '" data-a="perRapido" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<div class="sub">O elige las fechas en el calendario. Se cuentan los reportes que llegaron en ese periodo.</div>' +
    '<div class="two"><label class="f"><span>Desde</span><input type="date" data-f="desde" max="' + hoy + '" value="' + esc(ui.sh.desde) + '"></label><label class="f"><span>Hasta</span><input type="date" data-f="hasta" max="' + hoy + '" value="' + esc(ui.sh.hasta) + '"></label></div>' +
    '<div class="btns"><button class="btn" data-a="close">Cancelar</button><button class="btn primary" data-a="perAplicar">Aplicar</button></div>';
}
function sheetRep(){
  var raw = DB.reportes[ui.sheet.id]; if (!raw) return '';
  var r = Object.assign({ id: ui.sheet.id }, raw), e = eqById(r.equipoId), sh = ui.sh, hecho = r.estado === 'resuelto';
  return mHead(e.nombre) +
    '<div class="rep ' + semaforo(r) + '" style="margin-bottom:14px"><div class="rep-h">' + pillEstado(r) + pillUrg(r) + '</div>' +
    '<span class="rep-d">' + esc(r.desc) + '</span><small>' + esc(eqLugar(e)) + ' · ' + esc(r.prof || 'Instructor') + (r.area ? ' · ' + esc(r.area) : '') + (r.clase ? ' · ' + esc(r.clase) : '') + ' · ' + hace(r.creado) + '</small>' +
    timerHTML(r) + '</div>' + tiemposHTML(r) + fotosHTML(r) + piezaHTML(r, sh, hecho) +
    '<label class="f"><span>Qué encontraste y qué hiciste</span><textarea data-f="diag"' + (hecho ? ' disabled' : '') + ' placeholder="Describe la anomalía y la atención">' + esc(sh.diag) + '</textarea></label>' +
    '<label class="chk"><input type="checkbox" data-f="compra"' + (sh.compra ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita comprar algo</label>' +
    '<label class="chk"><input type="checkbox" data-f="cambio"' + (sh.cambio ? ' checked' : '') + (hecho ? ' disabled' : '') + '> Necesita cambio de pieza o equipo</label>' +
    '<label class="f" style="margin-top:8px"><span>Costo estimado (opcional)</span><input inputmode="decimal" data-f="costo" value="' + esc(sh.costo) + '" placeholder="0"' + (hecho ? ' disabled' : '') + '></label>' +
    (hecho ? '<div class="sub">Este reporte ya está resuelto. Se quita cuando el instructor lo elimine.</div>' :
      (esperaPz(r) ? '<div class="sub" style="margin-bottom:8px"><b>No se puede marcar resuelto mientras se espera la pieza.</b> Cuando llegue, toca “Ya llegó la pieza”.</div>' : '') +
      '<div class="btns"><button class="btn" data-a="saveRep">Guardar nota</button><button class="btn primary" data-a="resolveRep"' + (esperaPz(r) ? ' disabled' : '') + '>Marcar resuelto</button></div>');
}
function sheetNombre(){
  return mHead('¿Cómo te llamas?') + '<div class="sub">Tu nombre aparece en los reportes que atiendas.</div>' +
    '<label class="f"><span>Nombre</span><input data-f="nombre" placeholder="Ej. Juan Pérez" value="' + esc(ui.sh.nombre) + '" autocomplete="name"></label>' +
    '<button class="btn cta block" data-a="guardaNombre">Guardar</button>';
}
function sheetPosp(){
  var p = DB.preventivo[ui.sheet.id]; if (!p) return '';
  var motivos = ['Evento del club', 'Falta refacción', 'Falta personal', 'Otro'];
  return mHead('Posponer') + '<div class="card" style="margin-bottom:12px"><b>' + esc(p.titulo) + '</b><div class="sub" style="margin:2px 0 0">' + esc(p.detalle || '') + '</div></div>' +
    '<div class="lbl" style="font-weight:600;font-size:13px;color:var(--ink-2)">Motivo</div><div class="chips">' + motivos.map(function(m){ return '<button class="chip' + (ui.sh.motivo === m ? ' on' : '') + '" data-a="motivo" data-v="' + m + '">' + m + '</button>'; }).join('') + '</div>' +
    '<label class="f"><span>Nueva fecha</span><input type="date" data-f="fecha" min="' + fechaInput(sod(now()) + DAY) + '" value="' + esc(ui.sh.fecha) + '"></label>' +
    '<button class="btn cta block" data-a="prevPospSave">Guardar nueva fecha</button><div class="sub" style="margin-top:10px">Gerencia ve cuántas veces se pospone un preventivo y por qué.</div>';
}
function invHTML(e){
  var v = e && e.inv; if (!v) return '';
  var n = nrm(v.nivel), c = /alta/.test(n) ? 'bad' : /media/.test(n) ? 'warn' : 'ok';
  function fila(t, x){ return x ? '<div style="margin-top:6px"><small class="mut">' + t + '</small><div>' + esc(x) + '</div></div>' : ''; }
  return '<div class="card" style="margin-top:12px"><div class="h2 sm" style="margin:0 0 6px">Inventario' + (e.marca ? ' · ' + esc(e.marca) : '') + '</div>' +
    (v.nivel ? pill('Nivel ' + v.nivel, c) + (v.intervencion ? ' ' + pill(v.intervencion, 'mut') : '') : '') +
    fila('Hallazgo', v.hallazgo) + fila('Corrección requerida', v.correccion) + fila('Material necesario', v.material) +
    '<div class="sub" style="margin:8px 0 0;font-size:12px">Levantamiento del ' + esc(v.fecha || '') + '</div></div>';
}
function sheetEq(){
  var raw = DB.equipos[ui.sheet.id]; if (!raw) return '';
  var e = eqById(ui.sheet.id), s = eqEstado(e.id);
  var h = abiertos().concat(lista('historial')).filter(function(r){ return r.equipoId === e.id; }).sort(function(a, b){ return b.creado - a.creado; });
  return mHead(e.nombre) +
    '<div class="eq" style="margin-bottom:12px"><div class="pic">' + ic('img') + esc(e.foto || '') + (e.foto ? '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
    '<div class="sub" style="margin:0 0 6px">' + esc(eqLugar(e)) + ' · ' + esc(eqArea(e)) + '</div>' + pill(s.t, s.c + ' big') +
    invHTML(raw) +
    '<div class="btns"><button class="btn" data-a="eqEdit" data-v="' + e.id + '">Editar equipo</button><button class="btn" data-a="eqQR" data-v="' + e.id + '">Código QR</button></div>' +
    '<div class="h2 sm">Historial</div>' + (h.length ? '<div class="stack">' + h.map(function(r){
      return '<div class="rep ' + (r.cerrado ? 'verde' : semaforo(r)) + '"><div class="rep-h">' + (r.cerrado ? pill('Cerrado', 'ok big') : pillEstado(r)) + '<span class="go mut" style="font-size:12.5px">' + hace(r.creado) + '</span></div><span class="rep-d">' + esc(r.desc) + '</span>' + (r.diag ? '<small>' + esc(r.diag) + '</small>' : '') + '</div>';
    }).join('') + '</div>' : empty('Este equipo no tiene reportes.'));
}
function sheetPrevEq(){
  var raw = DB.equipos[ui.sheet.id]; if (!raw) return '';
  var e = eqById(ui.sheet.id), p = eqPrev(e), sh = ui.sh;
  var log = lista('prevlog').filter(function(x){ return x.equipoId === e.id; }).sort(function(a, b){ return b.t - a.t; }).slice(0, 4);
  return mHead(e.nombre) +
    '<div class="eq ' + p.c + '" style="margin-bottom:12px"><div class="pic">' + ic('img') + esc(e.foto || '') + (e.foto ? '<img src="img/equipos/' + encodeURIComponent(e.foto) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
    '<div class="sub" style="margin:0 0 6px">' + esc(eqLugar(e)) + '</div>' + pill(p.t, (p.c === 'rojo' ? 'bad' : p.c === 'amar' ? 'warn' : 'ok') + ' big') +
    (p.rep.length ? '<div class="h2 sm">Primero atiende ' + (p.rep.length > 1 ? 'estos reportes' : 'este reporte') + '</div><div class="stack">' + p.rep.map(function(r){ return repCard(r, true); }).join('') + '</div>' : '') +
    '<div class="h2 sm">Revisión preventiva</div>' +
    '<div class="sub" style="margin:-4px 0 8px">' + (e.prevUlt ? 'Última revisión: ' + fechaHora(e.prevUlt) + (e.prevPor ? ' · ' + esc(e.prevPor) : '') : 'Todavía no tiene revisión preventiva registrada.') + ' Se vuelve a pedir cada ' + plu(prevFreqSalon(e.salonId), 'día', 'días') + '.</div>' +
    '<label class="f"><span>Qué revisaste o ajustaste (opcional)</span><textarea data-f="nota" placeholder="Ej. Se apretó tornillería y se lubricó">' + esc(sh.nota || '') + '</textarea></label>' +
    '<button class="btn cta block" data-a="prevEqHecho">Revisión preventiva hecha</button>' +
    '<div class="two" style="margin-top:12px;align-items:end"><label class="f" style="margin:0"><span>O posponer (evento, falta de tiempo)</span><input type="date" data-f="posp" min="' + fechaInput(sod(now()) + DAY) + '" value="' + esc(sh.posp || '') + '"></label>' +
    '<button class="btn" data-a="prevEqPosp">Posponer</button></div>' +
    (log.length ? '<div class="h2 sm">Últimas revisiones</div><div class="card">' + log.map(function(x){ return '<div class="row"><div><b>' + fechaHora(x.t) + (x.por ? ' · ' + esc(x.por) : '') + '</b>' + (x.nota ? '<small>' + esc(x.nota) + '</small>' : '') + '</div></div>'; }).join('') + '</div>' : '');
}
function sheetQR(){
  var raw = DB.equipos[ui.sheet.id]; if (!raw) return '';
  var e = eqById(ui.sheet.id);
  return mHead('Código QR') +
    '<div style="max-width:260px;margin:4px auto 10px;background:#fff;border-radius:14px;padding:6px">' + qrSvg(e.id) + '</div>' +
    '<div style="text-align:center"><b>' + esc(e.nombre) + '</b><div class="sub" style="margin:2px 0 8px">' + esc(eqLugar(e)) + '</div></div>' +
    '<div class="sub" style="text-align:center;margin-bottom:8px">Imprímelo y pégalo en el equipo. El instructor lo escanea desde Control Fitness y se llena solo el equipo, con su foto.</div>' +
    '<button class="btn cta block" data-a="qrPrint" data-v="' + e.id + '">Imprimir etiqueta</button>' +
    '<button class="btn block" style="margin-top:10px" data-a="eqOpen" data-v="' + e.id + '">Volver al equipo</button>';
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

/* ---------- importar equipos desde Excel o CSV ----------
   Columnas: Salón · Área · Equipo · Marca · Tipo · Foto  (Salón y Equipo son obligatorias).
   Un equipo se reconoce por su salón y su nombre: volver a importar el mismo archivo no duplica nada, solo completa o actualiza.
   Los salones que no existan se crean solos. La foto es el nombre del archivo que se sube a img/equipos. */
var IMP_COLS = { salon:['salon','zona','lugar','salon o zona'], area:['area','disciplina'], nombre:['equipo','nombre','nombre del equipo'], marca:['marca'], tipo:['tipo','modelo'], foto:['foto','archivo','archivo de foto','imagen'] };
function csvParse(txt){
  txt = String(txt == null ? '' : txt).replace(/^﻿/, '');
  var l1 = txt.split(/\r?\n/)[0] || '', cT = l1.split('\t').length, cS = l1.split(';').length, cC = l1.split(',').length;
  var d = cT > 1 ? '\t' : (cS > cC ? ';' : ',');
  var rows = [], row = [], f = '', q = false, i, c;
  for (i = 0; i < txt.length; i++) {
    c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(x){ return String(x).trim() !== ''; }); });
}
function slugImp(t){ return nrm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'; }
function impAnaliza(txt){
  var rows = csvParse(txt), res = { items:[], salonesNuevos:[], errores:[], nuevos:0, existentes:0, error:'' };
  if (rows.length < 2) { res.error = 'No encontré datos. La primera fila debe tener los títulos de las columnas y debajo los equipos.'; return res; }
  var hdr = rows[0].map(function(h){ return nrm(h); }), idx = {};
  Object.keys(IMP_COLS).forEach(function(k){ idx[k] = -1; IMP_COLS[k].forEach(function(n){ if (idx[k] < 0) idx[k] = hdr.indexOf(n); }); });
  if (idx.nombre < 0 || idx.salon < 0) { res.error = 'Faltan columnas. Se necesitan al menos “Salón” y “Equipo” en la primera fila.'; return res; }
  var salByName = {}; lista('salones').forEach(function(s){ salByName[nrm(s.nombre)] = s; });
  var nuevosSal = {}, vistos = {}, eqExist = {};
  lista('equipos').forEach(function(e){ eqExist[e.salonId + '|' + nrm(e.nombre)] = e; });
  var g = function(r, k){ return idx[k] >= 0 ? String(r[idx[k]] == null ? '' : r[idx[k]]).trim() : ''; };
  rows.slice(1).forEach(function(r, n){
    var fila = n + 2, sal = g(r, 'salon'), nom = g(r, 'nombre');
    if (!sal && !nom) return;
    if (!sal || !nom) { res.errores.push('Fila ' + fila + ': falta ' + (!sal ? 'el salón' : 'el nombre del equipo')); return; }
    var s = salByName[nrm(sal)], sid;
    if (s) sid = s.id;
    else {
      sid = nuevosSal[nrm(sal)] ? nuevosSal[nrm(sal)].id : 'sal-' + slugImp(sal);
      if (!nuevosSal[nrm(sal)]) { nuevosSal[nrm(sal)] = { id:sid, nombre:sal, area:g(r, 'area') || sal }; res.salonesNuevos.push(nuevosSal[nrm(sal)]); }
    }
    var key = sid + '|' + nrm(nom);
    if (vistos[key]) { res.errores.push('Fila ' + fila + ': “' + nom + '” está repetido en ' + sal + ' (se ignora)'); return; }
    vistos[key] = 1;
    var ex = eqExist[key];
    res.items.push({ id: ex ? ex.id : 'imp-' + slugImp(sal) + '-' + slugImp(nom), nombre:nom, salonId:sid, salon:sal, marca:g(r, 'marca'), tipo:g(r, 'tipo'), foto:g(r, 'foto'), existe:!!ex });
    if (ex) res.existentes++; else res.nuevos++;
  });
  if (!res.items.length && !res.error) res.error = 'No quedó ningún equipo para importar.' + (res.errores.length ? ' Revisa los avisos.' : '');
  return res;
}
function impPlantilla(){
  var csv = '﻿Salón;Área;Equipo;Marca;Tipo;Foto\r\nSalon Spinning;Spinning;Bicicleta 1;Spinner Ride;Bicicleta indoor;spinning-01.jpg\r\nCanchas de tenis;Tenis;Red cancha 1;;Red;\r\n';
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' })); a.download = 'plantilla-equipos.csv';
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function sheetImp(){
  var p = ui.sh.prev, h = mHead('Importar equipos') +
    '<div class="sub">Sube un Excel (.xlsx) o un CSV con una fila por equipo y las columnas <b>Salón, Área, Equipo, Marca, Tipo, Foto</b>. Solo Salón y Equipo son obligatorias. También puedes copiar las filas desde Excel y pegarlas abajo.</div>' +
    '<div class="btns" style="margin-top:0"><label class="btn primary" style="cursor:pointer"><input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" data-imp hidden>Elegir archivo</label><button class="btn" data-a="impPlantilla">Bajar plantilla</button></div>' +
    '<label class="f"><span>O pega aquí las filas</span><textarea data-f="txt" rows="4" placeholder="Salón&#9;Área&#9;Equipo&#9;Marca&#9;Tipo&#9;Foto">' + esc(ui.sh.txt) + '</textarea></label>' +
    '<button class="btn block" data-a="impLee">Revisar lo que voy a importar</button>';
  if (ui.sh.msg) h += '<div class="sub" style="margin-top:10px">' + esc(ui.sh.msg) + '</div>';
  if (p) {
    if (p.error) h += '<div class="vinc off" style="margin-top:12px"><b>No se pudo leer</b><span>' + esc(p.error) + '</span></div>';
    else {
      h += '<div class="card" style="margin-top:12px"><div class="h2 sm" style="margin:0 0 8px">Esto es lo que se va a hacer</div>' +
        '<div class="row"><div><b>' + plu(p.nuevos, 'equipo nuevo', 'equipos nuevos') + '</b><small>' + plu(p.existentes, 'ya existe (se completa o actualiza, no se duplica)', 'ya existen (se completan o actualizan, no se duplican)') + '</small></div></div>' +
        (p.salonesNuevos.length ? '<div class="row"><div><b>' + plu(p.salonesNuevos.length, 'salón nuevo', 'salones nuevos') + '</b><small>' + esc(p.salonesNuevos.map(function(s){ return s.nombre; }).join(', ')) + '</small></div></div>' : '') +
        p.items.slice(0, 6).map(function(x){ return '<div class="row"><div><b>' + esc(x.nombre) + '</b><small>' + esc(x.salon) + (x.marca ? ' · ' + esc(x.marca) : '') + (x.foto ? ' · ' + esc(x.foto) : '') + (x.existe ? ' · ya existe' : '') + '</small></div></div>'; }).join('') +
        (p.items.length > 6 ? '<div class="sub" style="margin:6px 0 0">y ' + (p.items.length - 6) + ' más…</div>' : '') + '</div>' +
        (p.errores.length ? '<div class="vinc off" style="margin-top:10px"><b>' + plu(p.errores.length, 'aviso', 'avisos') + '</b><span>' + p.errores.slice(0, 5).map(esc).join('<br>') + (p.errores.length > 5 ? '<br>…' : '') + '</span></div>' : '') +
        '<button class="btn cta block" style="margin-top:12px" data-a="impAplica">Importar ' + plu(p.items.length, 'equipo', 'equipos') + '</button>';
    }
  }
  return h;
}
function impCargaXlsx(){
  return new Promise(function(ok, ko){
    if (window.XLSX) return ok();
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = function(){ ko(new Error('No se pudo cargar el lector de Excel. Revisa tu internet o guarda el archivo como CSV.')); }; document.head.appendChild(s);
  });
}
function impArchivo(file){
  var esXl = /\.xlsx?$/i.test(file.name);
  ui.sh.msg = 'Leyendo ' + file.name + '…'; render();
  var rd = new FileReader();
  rd.onerror = function(){ ui.sh.msg = 'No se pudo leer el archivo.'; render(); };
  rd.onload = function(){
    var fin = function(txt){ ui.sh.txt = txt; ui.sh.msg = ''; ui.sh.prev = impAnaliza(txt); render(); };
    if (!esXl) return fin(rd.result);
    impCargaXlsx().then(function(){
      var wb = XLSX.read(rd.result, { type:'array' }), ws = wb.Sheets[wb.SheetNames[0]];
      fin(XLSX.utils.sheet_to_csv(ws, { FS:'\t' }));
    }).catch(function(e){ ui.sh.msg = e.message || 'No se pudo leer el Excel.'; render(); });
  };
  if (esXl) rd.readAsArrayBuffer(file); else rd.readAsText(file, 'utf-8');
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
  var n = id === 'reportes' ? abiertos().filter(function(r){ return r.estado === 'nuevo'; }).length : id === 'preventivo' ? lista('preventivo').filter(function(p){ return diasPrev(p) < 0; }).length + lista('equipos').filter(function(e){ return eqPrev(e).c === 'rojo'; }).length : 0;
  return n ? '<span class="pill bad" style="margin-left:auto;padding:1px 8px">' + n + '</span>' : '';
}
function sidebar(){
  var c = cloud();
  return '<aside class="sidebar"><div class="sb-brand"><div class="sb-logo"><span>C</span><img src="img/logo.png" alt="Club Campestre Aguascalientes" data-fallback></div>' +
    '<div><b>Control Mantenimiento</b><small>Club Campestre</small></div></div>' +
    '<nav class="sb-nav">' + NAV.map(function(n){ return '<button class="' + (ui.tab === n[0] ? 'on' : '') + '" data-a="tab" data-v="' + n[0] + '">' + ic(n[3]) + '<span>' + n[1] + '</span>' + badgeNav(n[0]) + '</button>'; }).join('') + '</nav>' +
    '<div class="sb-foot"><div class="sb-user"><b>' + esc(REQ_ACCESO && usuario ? nombreTec() : 'Mantenimiento') + '</b>Técnico</div><span class="cloud ' + c.cls + '"><i></i>' + c.txt + '</span>' +
    (REQ_ACCESO && usuario ? '<button class="btn sm" data-a="salir">Cerrar sesión</button>' : '') + '</div></aside>';
}
function topbar(t){
  var c = cloud();
  return '<header class="topbar"><div class="tb-logo only-m"><span>C</span><img src="img/logo.png" alt="Club Campestre" data-fallback></div>' +
    '<div class="tb-t"><b>' + esc(t[0]) + '</b><small>' + esc(t[1]) + '</small><span class="cloud ' + c.cls + '"><i></i>' + c.txt + '</span></div>' +
    (REQ_ACCESO && usuario ? '<button class="ibtn only-m" data-a="salir" aria-label="Cerrar sesión">' + ic('logout') + '</button>' : '') + '</header>';
}
function bottomnav(){
  return '<nav class="bottomnav" aria-label="Navegación">' + NAV.map(function(n){
    return '<button class="' + (ui.tab === n[0] ? 'on' : '') + '" data-a="tab" data-v="' + n[0] + '">' + ic(n[3]) + '<span>' + n[2] + '</span></button>';
  }).join('') + '</nav>';
}
/* ---------- el carrusel avanza solo ---------- */
var CAR_SEG = (typeof CARRUSEL_SEGUNDOS !== 'undefined' ? CARRUSEL_SEGUNDOS : 6), CAR_ESPERA = (typeof CARRUSEL_ESPERA !== 'undefined' ? CARRUSEL_ESPERA : 15), carUlt = 0, carHover = false;
function carToca(){ carUlt = now(); }
function carObjetivo(c, i){
  var k = c.children[i], al = getComputedStyle(k).scrollSnapAlign || '';
  return al.indexOf('center') >= 0 ? k.offsetLeft - (c.clientWidth - k.offsetWidth) / 2 : k.offsetLeft - 2;
}
function carAvanza(){
  var c = document.querySelector('.carr'); if (!c || ui.sheet || document.hidden || ui.carrPausa || carHover) return;
  if (now() - carUlt < CAR_ESPERA * 1000) return;
  var n = c.children.length; if (n < 2) return;
  var max = c.scrollWidth - c.clientWidth, cur = 0, best = 1e9;
  for (var i = 0; i < n; i++) { var d = Math.abs(carObjetivo(c, i) - c.scrollLeft); if (d < best) { best = d; cur = i; } }
  var fin = c.scrollLeft >= max - 3 || cur + 1 >= n;
  c.scrollTo({ left: fin ? 0 : Math.min(max, Math.max(0, carObjetivo(c, cur + 1))), behavior:'smooth' });
}
function carrN(){
  var c = document.querySelector('.carr'), n = document.getElementById('carr-n'); if (!c || !n || !c.children.length) return;
  var w = c.children[0].offsetWidth + 12, i = w > 0 ? Math.min(c.children.length - 1, Math.round(c.scrollLeft / w)) : 0;
  n.textContent = (i + 1) + ' de ' + c.children.length;
}
function render(){
  ui.dirty = false;
  if (REQ_ACCESO && !usuario) {            /* carátula de acceso */
    document.getElementById('app').innerHTML = loginHTML();
    var m0 = document.getElementById('modal'); m0.hidden = true; m0.innerHTML = ''; document.body.style.overflow = '';
    return;
  }
  if (RESTAURA && DB.reportes && DB.reportes[RESTAURA.id] && !ui.sheet) {
    ui.tab = 'reportes'; ui.sheet = { k:'rep', id: RESTAURA.id }; ui.sh = Object.assign({ diag:'', compra:false, cambio:false, costo:'' }, RESTAURA.sh || {});
    if (FOT[RESTAURA.id] === undefined) cargaFotos(RESTAURA.id);
  }
  if (ready) RESTAURA = null;
  var car0 = document.querySelector('.carr'), sl = car0 && !ui.reset ? car0.scrollLeft : 0, sy = window.pageYOffset || 0;
  var sh0 = document.querySelector('#modal .sheet'), ss = sh0 ? sh0.scrollTop : 0; ui.reset = false;
  if (EQ_LINK && DB.equipos) {              /* abierto desde un QR: mostrar la ficha de ese equipo */
    var qid = ''; try { qid = decodeURIComponent(EQ_LINK); } catch(e){ qid = EQ_LINK; }
    if (DB.equipos[qid]) { ui.tab = 'equipos'; ui.sheet = { k:'eq', id:qid }; }
    EQ_LINK = null;
  }
  var t = ui.tab, body = t === 'reportes' ? vReportes() : t === 'preventivo' ? vPreventivo() : t === 'equipos' ? vEquipos() : vGerencia();
  var errBanner = fbError ? '<div class="vinc off"><b>No se pudo conectar con la base de datos</b><span>' + esc(fbError) + '</span></div>'
    : !online ? '<div class="vinc off"><b>Sin internet</b><span>Los cambios se envían al volver la señal. No cierres la app hasta entonces.</span></div>' : '';
  document.getElementById('app').innerHTML = '<div class="app">' + sidebar() + '<div class="content">' + topbar(TITULOS[t]) + '<main class="main">' + errBanner + body + '</main></div>' + bottomnav() + '</div>';
  var m = document.getElementById('modal'), k = ui.sheet && ui.sheet.k, html = '';
  if (k) html = k === 'rep' ? sheetRep() : k === 'posp' ? sheetPosp() : k === 'eq' ? sheetEq() : k === 'eqform' ? sheetEqForm() : k === 'eqqr' ? sheetQR() : k === 'prevEq' ? sheetPrevEq() : k === 'sal' ? sheetSalones() : k === 'imp' ? sheetImp() : k === 'cal' ? sheetCal() : k === 'infdoc' ? sheetInfDoc() : k === 'nombre' ? sheetNombre() : sheetPrevForm();
  if (html) { m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>' + (ui.zoom ? '<div class="zoom" data-a="zoomCierra"><img src="' + ui.zoom + '" alt=""></div>' : ''); m.hidden = false; document.body.style.overflow = 'hidden'; }
  else { m.hidden = true; m.innerHTML = ''; document.body.style.overflow = ''; }
  if (k === 'infdoc') infMonta();
  var car1 = document.querySelector('.carr'); if (car1) { car1.scrollLeft = sl; carrN(); }
  var sh1 = document.querySelector('#modal .sheet'); if (sh1 && ss) sh1.scrollTop = ss;
  if (sy) window.scrollTo(0, sy);
  guardaSheet();
}
function escribiendo(){ var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
function softRender(){ if (escribiendo() || (ui.sheet && ui.sheet.k === 'infdoc')) { ui.dirty = true; return; } render(); }
var toastT;
function toast(msg){ var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove('show'); }, 2800); }
function top0(){ window.scrollTo(0, 0); }

/* ---------- acciones ---------- */
var A = {
  entrar:function(){
    var u = ((document.getElementById('lg_u') || {}).value || '').trim().toLowerCase(), p = (document.getElementById('lg_p') || {}).value || '';
    ui.lgU = u;
    if (!u || !p) { ui.lgErr = 'Escribe tu usuario y tu PIN.'; render(); return; }
    if (!auth) { ui.lgErr = 'El acceso no está disponible. ' + (fbError || ''); render(); return; }
    ui.lgBusy = true; ui.lgErr = ''; render();
    auth.signInWithEmailAndPassword(u.indexOf('@') >= 0 ? u : u + '@' + DOMINIO_ACCESO, p)
      .then(function(){ ui.lgBusy = false; ui.lgErr = ''; })
      .catch(function(e){ ui.lgBusy = false; ui.lgErr = msgAuth(e); render(); });
  },
  salir:function(){ if (!confirm('¿Cerrar sesión?')) return; ui.sheet = null; ui.zoom = null; if (auth) auth.signOut(); },
  guardaNombre:function(){
    var n = (ui.sh.nombre || '').trim(); if (!n) return toast('Escribe tu nombre');
    if (!usuario) return;
    db.ref('usuarios/' + usuario.uid).set({ nombre:n, email:usuario.email || '', creado: now() }).then(function(){ toast('Listo, ' + n); }).catch(function(e){ toast('No se pudo guardar: ' + e.message); });
    perfil = { nombre:n }; ui.sheet = null; render();
  },
  camAbre:function(v){ camAbre(v); },
  respaldo:function(){ respaldoManual(false); },
  respaldoFotos:function(){ respaldoManual(true); },
  zoom:function(v){ var f = FOT[ui.sheet && ui.sheet.id] || {}; if (f[v]) { ui.zoom = f[v]; render(); } },
  zoomCierra:function(){ ui.zoom = null; render(); },
  tab:function(v){ ui.tab = v; ui.sheet = null; ui.areaF = 'Todos'; render(); top0(); },
  estado:function(v){ ui.estado = ui.estado === v ? null : v; ui.reset = true; render(); },
  calAbre:function(){
    var R = rangoPer(), hoy = sod(now());
    ui.sheet = { k:'cal' }; ui.sh = { desde: fechaInput(R && R.desde > 0 ? R.desde : addDias(hoy, -6)), hasta: fechaInput(R ? Math.min(R.hasta, hoy) : hoy) }; render();
  },
  perRapido:function(v){ ui.per = { t:v }; ui.estado = null; ui.reset = true; ui.sheet = null; render(); },
  perAplicar:function(){
    var d = ui.sh.desde, h = ui.sh.hasta; if (!d || !h) return toast('Elige las dos fechas');
    if (d > h) { var x = d; d = h; h = x; }
    ui.per = { t:'custom', desde:d, hasta:h }; ui.estado = null; ui.reset = true; ui.sheet = null; render();
  },
  carrPausa:function(){ ui.carrPausa = !ui.carrPausa; render(); },
  urgAbre:function(){ ui.urgAbre = !ui.urgAbre; render(); },
  urgTodos:function(){ ui.urg = null; ui.urgAbre = false; ui.reset = true; render(); },
  urg:function(v){ ui.urg = ui.urg === v ? null : v; ui.reset = true; render(); },
  carr:function(v){ carToca(); var c = document.querySelector('.carr'); if (c) c.scrollBy({ left: (+v) * c.clientWidth * 0.9, behavior:'smooth' }); },
  areaF:function(v){ ui.areaF = v; render(); },
  close:function(){ ui.sheet = null; render(); },
  /* reportes: al abrir uno nuevo pasa solo a "en proceso" (amarillo) */
  openRep:function(v){
    var r = DB.reportes[v]; if (!r) return;
    ui.sheet = { k:'rep', id:v }; ui.sh = { diag: r.diag || '', compra: !!r.compra, cambio: !!r.cambio, costo: r.costo || '' };
    if (r.estado === 'nuevo') actualiza('reportes/' + v, { estado:'atencion', visto: now(), tecnico: nombreTec(), tecnicoId: usuario ? usuario.uid : undefined });
    if (FOT[v] === undefined) cargaFotos(v);
    render();
  },
  saveRep:function(){ var id = ui.sheet.id, s = ui.sh; ui.sheet = null; actualiza('reportes/' + id, { diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); render(); toast('Nota guardada'); },
  resolveRep:function(){
    if (esperaPz(DB.reportes[ui.sheet.id] || {})) return toast('Todavía se espera una pieza. Marca primero que ya llegó.');
    if (!ui.sh.diag.trim()) return toast('Anota qué encontraste y qué hiciste');
    var fo = FOT[ui.sheet.id] || {};
    if (!fo.despues) {
      if (FOTO_OBLIG) return toast('Toma la foto del después antes de marcarlo resuelto');
      if (!confirm('No tomaste la foto del después. ¿Marcarlo como resuelto sin foto?')) return;
    }
    var id = ui.sheet.id, s = ui.sh, raw = DB.reportes[id] || {}, t = now(), cre = raw.creado || t, vis = raw.visto || t; ui.sheet = null;
    /* se guardan las fechas y los tiempos (ms) para el control de tiempos y los reportes futuros */
    var pz = arr(raw.piezas).map(function(x){ return x.llego ? x : Object.assign({}, x, { llego:t }); }), mp = msPiezas({ piezas:pz }, t);
    actualiza('reportes/' + id, { estado:'resuelto', resuelto:t, visto:vis, msRespuesta:vis - cre, msAtencion:t - vis, msTotal:t - cre, msPieza: pz.length ? mp : undefined, msTrabajo: pz.length ? Math.max(0, t - vis - mp) : undefined,
      piezas: pz.length ? pz : undefined, esperaPieza:false, resueltoPor:nombreTec(), diag:s.diag, compra:s.compra, cambio:s.cambio, costo:s.costo }); render();
    toast('Resuelto. Se avisó al instructor y a gerencia.');
  },
  piezaPide:function(){
    var id = ui.sheet.id, r = DB.reportes[id], d = (ui.sh.pieza || '').trim(); if (!r) return;
    if (!d) return toast('Escribe qué pieza o material se necesita');
    var pz = arr(r.piezas).concat([{ desc:d, pedida:now(), por:nombreTec() }]);
    ui.sh.pieza = ''; ui.sh.compra = true;
    actualiza('reportes/' + id, { piezas:pz, esperaPieza:true, compra:true, diag:ui.sh.diag, cambio:ui.sh.cambio, costo:ui.sh.costo }); render();
    toast('Pieza pedida. Quedó marcada la hora.');
  },
  piezaLlego:function(){
    var id = ui.sheet.id, r = DB.reportes[id]; if (!r) return;
    var t = now(), pz = arr(r.piezas).map(function(x){ return x.llego ? x : Object.assign({}, x, { llego:t }); });
    actualiza('reportes/' + id, { piezas:pz, esperaPieza:false }); render(); toast('Listo. Se registró la hora en que llegó la pieza.');
  },
  /* recorrido preventivo por salón */
  prevSalon:function(v){ ui.prevSalon = v || null; ui.prevSolo = false; ui.reset = true; render(); top0(); },
  prevSolo:function(){ ui.prevSolo = !ui.prevSolo; render(); },
  prevEq:function(v){ ui.sheet = { k:'prevEq', id:v }; ui.sh = { nota:'', posp:'' }; render(); },
  prevEqHecho:function(){
    var id = ui.sheet.id, e = DB.equipos[id]; if (!e) return; var t = now(), nota = (ui.sh.nota || '').trim();
    actualiza('equipos/' + id, { prevUlt:t, prevPor:nombreTec(), prevPosp:null });
    guarda('prevlog/' + nuevoId('prevlog'), limpia({ equipoId:id, salonId:e.salonId, t:t, por:nombreTec(), nota:nota || undefined }));
    ui.sheet = null; render(); toast('Revisión guardada. Próxima: en ' + plu(prevFreqSalon(e.salonId), 'día', 'días'));
  },
  prevEqPosp:function(){
    var id = ui.sheet.id, f = ui.sh.posp; if (!f) return toast('Elige hasta qué fecha se pospone');
    var d = new Date(f + 'T00:00:00').getTime(); ui.sheet = null; actualiza('equipos/' + id, { prevPosp:d }); render(); toast('Pospuesto al ' + fechaTxt(d));
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
  eqQR:function(v){ ui.sheet = { k:'eqqr', id:v }; render(); },
  qrPrint:function(v){ imprimeEtiquetas([v]); },
  qrAll:function(){
    var ids = lista('equipos').filter(function(e){ return ui.areaF === 'Todos' || eqArea(e) === ui.areaF; })
      .sort(function(a, b){ return eqLugar(a).localeCompare(eqLugar(b), 'es') || a.nombre.localeCompare(b.nombre, 'es', { numeric:true }); }).map(function(e){ return e.id; });
    imprimeEtiquetas(ids);
  },
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

  impAbre:function(){ ui.sheet = { k:'imp' }; ui.sh = { txt:'', prev:null, msg:'' }; render(); },
  impPlantilla:function(){ impPlantilla(); },
  impLee:function(){ if (!(ui.sh.txt || '').trim()) return toast('Elige un archivo o pega las filas'); ui.sh.msg = ''; ui.sh.prev = impAnaliza(ui.sh.txt); render(); },
  impAplica:function(){
    var p = ui.sh.prev; if (!p || p.error || !p.items.length) return;
    if (!db) return toast('Sin conexión con la base de datos');
    var up = {};
    p.salonesNuevos.forEach(function(s){ up['salones/' + s.id] = { nombre:s.nombre, area:s.area }; });
    p.items.forEach(function(x){
      if (x.existe) { up['equipos/' + x.id + '/nombre'] = x.nombre; ['marca', 'tipo', 'foto'].forEach(function(k){ if (x[k]) up['equipos/' + x.id + '/' + k] = x[k]; }); }
      else up['equipos/' + x.id] = limpia({ nombre:x.nombre, salonId:x.salonId, foto:x.foto || '', marca:x.marca || undefined, tipo:x.tipo || undefined, origen:'importado' });
    });
    db.ref().update(up).then(function(){ ui.sheet = null; render(); toast('Importados ' + plu(p.items.length, 'equipo', 'equipos')); }).catch(function(e){ toast('No se pudo importar: ' + e.message); });
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
  /* inventario real: carga única (ids fijos, no duplica) y limpieza de lo ficticio */
  invCarga:function(){
    var falta = invFaltan(), ej = ejemplos(), sid = salonSpinningId(), up = {};
    if (!falta.length && !ej.n) return toast('No hay nada que cargar');
    var txt = (falta.length ? 'Se cargan ' + falta.length + ' bicicletas del Salón de Spinning con sus fotos. ' : '') +
      (ej.n ? 'Se borran ' + plu(ej.eq.length, 'equipo', 'equipos') + ' de ejemplo, ' + plu(ej.prev.length, 'revisión', 'revisiones') + ' de ejemplo y ' + plu(ej.rep.length + ej.his.length, 'reporte', 'reportes') + ' de prueba (incluidos los hechos sobre equipos de ejemplo). ' : '') + '¿Continuar?';
    if (!confirm(txt)) return;
    if (falta.length && !(DB.salones || {})[sid]) up['salones/' + sid] = { nombre:'Salon Spinning', area:'Spinning' };
    falta.forEach(function(x){
      up['equipos/' + x.id] = { nombre:x.nombre, salonId:sid, foto:x.foto, marca:x.marca, tipo:x.tipo, origen:'inventario',
        inv:{ fecha:'2026-10-07', hallazgo:x.hallazgo || '', nivel:x.nivel || '', intervencion:x.intervencion || '', correccion:x.correccion || '', material:x.material || '' } };
    });
    ej.eq.forEach(function(e){ up['equipos/' + e.id] = null; });
    ej.prev.forEach(function(p){ up['preventivo/' + p.id] = null; });
    ej.rep.forEach(function(r){ up['reportes/' + r.id] = null; });
    ej.his.forEach(function(r){ up['historial/' + r.id] = null; });
    db.ref().update(up).then(function(){ toast(falta.length ? 'Inventario cargado' : 'Datos de ejemplo borrados'); }).catch(function(e){ toast('No se pudo cargar: ' + e.message); });
  }
};
document.addEventListener('click', function(e){
  if (e.target.id === 'modal') { A.close(); return; }
  var b = e.target.closest('[data-a]'); if (!b) return;
  var f = A[b.getAttribute('data-a')]; if (f) f(b.getAttribute('data-v'));
});
document.addEventListener('scroll', function(e){ if (e.target && e.target.classList && e.target.classList.contains('carr')) carrN(); }, true);
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function(ev){
  document.addEventListener(ev, function(e){ if (e.target.closest && e.target.closest('.carr, .carr-nav')) carToca(); }, { passive:true, capture:true });
});
document.addEventListener('mouseover', function(e){ carHover = !!(e.target.closest && e.target.closest('.carr')); });
document.addEventListener('keydown', function(e){
  if (e.key === 'Enter' && e.target && e.target.id === 'lg_p') { A.entrar(); return; }
  if (e.key === 'Escape') { if (ui.zoom) A.zoomCierra(); else if (ui.sheet) A.close(); }
});
document.addEventListener('change', function(e){
  var t = e.target, tipo = t && t.getAttribute && t.getAttribute('data-foto');
  if (t && t.hasAttribute && t.hasAttribute('data-imp') && t.files && t.files[0]) { impArchivo(t.files[0]); t.value = ''; return; }
  if (tipo && t.files && t.files[0]) { subeFoto(tipo, t.files[0]); t.value = ''; }
});
document.addEventListener('change', function(e){
  var t = e.target; if (t && t.getAttribute && t.getAttribute('data-a-change') === 'prevFreq' && ui.prevSalon) {
    actualiza('salones/' + ui.prevSalon, { prevFreq:+t.value }); toast('Este salón se revisa cada ' + plu(+t.value, 'día', 'días'));
  }
});
document.addEventListener('input', function(e){
  var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
  if (f && ui.sh) { ui.sh[f] = t.type === 'checkbox' ? t.checked : t.value; guardaSheet(); }
});
document.addEventListener('focusout', function(){ setTimeout(function(){ if (ui.dirty && !escribiendo()) render(); }, 150); });
document.addEventListener('error', function(e){ var t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) { t.style.display = 'none'; if (t.parentNode) t.parentNode.classList.add('nofoto'); } }, true);
if (window.matchMedia) { var mq = window.matchMedia('(min-width: 900px)'); var onMq = function(){ softRender(); }; mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener && mq.addListener(onMq); }

initFB();
render();
setInterval(carAvanza, CAR_SEG * 1000);
setInterval(function(){ archivaViejos(); }, 60000); setTimeout(archivaViejos, 8000);
setInterval(tick, 1000);                                                          // cronómetros
setInterval(function(){ if (!escribiendo() && !ui.sheet) render(); }, 300000);   // refresca etiquetas
