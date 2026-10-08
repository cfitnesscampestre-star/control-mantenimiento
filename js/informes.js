'use strict';
/* =====================================================================
   informes.js — Control Mantenimiento
   Pantalla "Reportes gerencia": cada indicador abre su lista en renglones (con fechas),
   un generador de reportes con filtros, impresión con el membrete de Campestre
   y envío a Control Gerencia (se guarda en /informes/{id}; Gerencia lo abre e imprime).

   Un informe es una "foto" ya armada:
     { titulo, sub, kpis:[[etiqueta, valor, nota]], secs:[{ t, cols:[{t,w,n}], filas:[[celda…]], sem:['rojo'|'amar'|'verde'|''] }], nota }
   Una celda puede traer varias líneas separadas con salto de línea: la primera va normal y las demás en letra chica.
   Gerencia lee esa foto tal cual, por eso no necesita ninguna de las reglas de este archivo.
   ===================================================================== */
var INF_PER = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['sem', 'Esta semana'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['90', '3 meses'], ['all', 'Todo'], ['p7', 'Próx. 7 días'], ['p30', 'Próx. 30 días'], ['custom', 'Fechas']];
var INF_MAX = 400;

/* ---------- configuración del informe ---------- */
function infCfg(o){
  var c = Object.assign({ tipo:'rep', per:'30', desde:'', hasta:'', fechaPor:'llegada', estado:'todos', urg:'', origen:'', area:'', lugar:'', tec:'', orden:'recientes', compra:false, fOpen:false }, o || {});
  infFechas(c); return c;
}
function infFechas(c){                       // las casillas de fecha muestran el rango del periodo elegido
  if (c.per === 'custom') { if (!c.desde) c.desde = fechaInput(sod(now())); if (!c.hasta) c.hasta = c.desde; return; }
  var R = infRango(c); if (R) { c.desde = fechaInput(R.desde); c.hasta = fechaInput(R.hasta); } else { c.desde = ''; c.hasta = ''; }
}
function infRango(c){
  var hoy = sod(now()), p = c.per, d, h;
  if (p === 'all') return null;
  if (p === 'hoy') { d = hoy; h = finDia(hoy); }
  else if (p === 'ayer') { d = addDias(hoy, -1); h = finDia(d); }
  else if (p === 'sem') { d = addDias(hoy, -((new Date(hoy).getDay() + 6) % 7)); h = finDia(addDias(d, 6)); }
  else if (p === '7') { d = addDias(hoy, -6); h = finDia(hoy); }
  else if (p === '30') { d = addDias(hoy, -29); h = finDia(hoy); }
  else if (p === '90') { d = addDias(hoy, -89); h = finDia(hoy); }
  else if (p === 'mes') { var m = new Date(hoy); m.setDate(1); d = m.getTime(); h = finDia(hoy); }
  else if (p === 'p7') { d = hoy; h = finDia(addDias(hoy, 6)); }
  else if (p === 'p30') { d = hoy; h = finDia(addDias(hoy, 29)); }
  else { d = new Date((c.desde || fechaInput(hoy)) + 'T00:00:00').getTime(); h = finDia(new Date((c.hasta || c.desde || fechaInput(hoy)) + 'T00:00:00').getTime()); if (h < d) h = finDia(d); }
  return { desde:d, hasta:h };
}
/* informes rápidos: los indicadores de arriba y los botones del generador */
var INF_RAP = {
  sin:     { t:'Sin atender', o:{ tipo:'rep', per:'all', estado:'nuevo', orden:'antiguos' } },
  pro:     { t:'En proceso', o:{ tipo:'rep', per:'all', estado:'atencion', orden:'antiguos' } },
  res:     { t:'Atendidos', o:{ tipo:'rep', per:'30', estado:'resuelto', fechaPor:'resuelto' } },
  ven:     { t:'Preventivos vencidos', o:{ tipo:'prev', per:'all', estado:'venc' } },
  posp:    { t:'Pospuestos', o:{ tipo:'prev', per:'all', estado:'posp' } },
  compras: { t:'Compras o cambios', o:{ tipo:'rep', per:'all', estado:'pend', compra:true, orden:'antiguos' } },
  dia:     { t:'Reporte del día', o:{ tipo:'act', per:'hoy' } },
  semprev: { t:'Preventivos de esta semana', o:{ tipo:'prev', per:'sem', estado:'prog' } },
  tiempo:  { t:'Problemas del mes, por tiempo', o:{ tipo:'rep', per:'30', orden:'mayor' } },
  pend:    { t:'Pendientes de atender', o:{ tipo:'rep', per:'all', estado:'pend', orden:'antiguos' } },
  fit:     { t:'Solo Fitness, últimos 30 días', o:{ tipo:'rep', per:'30', origen:'fitness' } },
  hechos:  { t:'Resueltos del mes', o:{ tipo:'rep', per:'mes', estado:'resuelto', fechaPor:'resuelto' } }
};

/* ---------- datos ---------- */
function infRepsAll(){
  var hist = lista('historial').concat(DB.archivoListo ? archivados() : []);
  return abiertos().filter(esGerencia).concat(hist.filter(esGerencia).map(function(r){ return Object.assign({}, r, { cerrada:true }); }));
}
function infAreaDe(r){ return (r.origen === 'gerencia' && r.area) ? r.area : eqArea(eqById(r.equipoId)); }
function infOrigen(r){ return esFitness(r) ? 'fitness' : 'gerencia'; }
function infTec(r){ return r.resueltoPor || r.tecnico || ''; }
function infRespMs(r){ return r.msRespuesta != null ? r.msRespuesta : r.visto ? r.visto - r.creado : null; }
function infTotMs(r){ return r.estado === 'resuelto' ? (r.msTotal != null ? r.msTotal : r.resuelto ? r.resuelto - r.creado : null) : null; }
function infDurMs(r){ var t = infTotMs(r); return t != null ? t : now() - r.creado; }
function fFecha(ts){ return new Date(ts).toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' }); }

function infReps(c, forzar){
  var R = infRango(c), fp = (forzar && forzar.fechaPor) || c.fechaPor, st = (forzar && forzar.estado) || c.estado;
  if ((!R || R.desde < now() - ARCHIVO_DIAS * DAY) && st !== 'nuevo' && st !== 'atencion' && st !== 'pend') cargaArchivo();   // lo archivado ya está resuelto
  return infRepsAll().filter(function(r){
    if (R) { var t = fp === 'resuelto' ? r.resuelto : r.creado; if (!t || t < R.desde || t > R.hasta) return false; }
    if (st === 'nuevo' || st === 'atencion' || st === 'resuelto') { if (r.estado !== st) return false; }
    else if (st === 'pend') { if (r.estado === 'resuelto') return false; }
    if (c.urg && r.urg !== c.urg) return false;
    if (c.origen && infOrigen(r) !== c.origen) return false;
    if (c.area && infAreaDe(r) !== c.area) return false;
    if (c.lugar && eqLugar(eqById(r.equipoId)) !== c.lugar) return false;
    if (c.tec && infTec(r) !== c.tec) return false;
    if (c.compra && !(r.compra || r.cambio)) return false;
    return true;
  });
}
function infOrdena(l, c, fp){
  var f = {
    recientes:function(a, b){ return fp === 'resuelto' ? (b.resuelto || 0) - (a.resuelto || 0) : b.creado - a.creado; },
    antiguos:function(a, b){ return a.creado - b.creado; },
    mayor:function(a, b){ return infDurMs(b) - infDurMs(a); },
    menor:function(a, b){ return infDurMs(a) - infDurMs(b); },
    equipo:function(a, b){ return eqById(a.equipoId).nombre.localeCompare(eqById(b.equipoId).nombre, 'es', { numeric:true }); },
    lugar:function(a, b){ return eqLugar(eqById(a.equipoId)).localeCompare(eqLugar(eqById(b.equipoId)), 'es') || a.creado - b.creado; }
  }[c.orden] || function(a, b){ return b.creado - a.creado; };
  return l.slice().sort(f);
}
function infPrevFiltra(p, c){
  if (c.lugar && salonById(p.salonId).nombre !== c.lugar) return false;
  if (c.area && salonById(p.salonId).area !== c.area) return false;
  return true;
}
function infPrevs(c){
  var R = infRango(c), st = c.estado;
  return lista('preventivo').filter(function(p){
    if (!infPrevFiltra(p, c)) return false;
    if (R && (p.proxima < R.desde || p.proxima > R.hasta)) return false;
    if (st === 'venc') return diasPrev(p) < 0;
    if (st === 'posp') return arr(p.posp).length > 0;
    return true;
  }).sort(function(a, b){ return a.proxima - b.proxima; });
}
function infPrevHechos(c){                       // una fila por cada vez que se marcó "ya se revisó"
  var R = infRango(c), out = [];
  lista('preventivo').forEach(function(p){
    if (!infPrevFiltra(p, c)) return;
    arr(p.hist).forEach(function(ts){ if (!R || (ts >= R.desde && ts <= R.hasta)) out.push({ p:p, ts:ts }); });
  });
  return out.sort(function(a, b){ return b.ts - a.ts; });
}

/* ---------- secciones (tablas) ---------- */
var INF_COLS_REP = [{ t:'Llegó', w:8 }, { t:'Equipo y lugar', w:17 }, { t:'Falla', w:22 }, { t:'Reportó', w:11 }, { t:'Estado', w:10 }, { t:'Atendió', w:10 }, { t:'Respuesta', w:7, n:1 }, { t:'Tiempo total', w:7, n:1 }, { t:'Compra o pieza', w:8 }];
function infSecRep(titulo, l){
  var s = { t:titulo, cols:INF_COLS_REP, filas:[], sem:[] };
  l.forEach(function(r){
    var e = eqById(r.equipoId), lug = eqLugar(e), ar = infAreaDe(r), resp = infRespMs(r), tot = infTotMs(r);
    var cp = [r.compra ? 'Compra' : '', r.cambio ? 'Cambio' : ''].filter(Boolean).join(' + ');
    s.filas.push([
      fechaHora(r.creado),
      e.nombre + '\n' + lug + (ar && nrm(ar) !== nrm(lug) ? ' · ' + ar : ''),
      (r.desc || '') + (r.urg && r.urg !== 'normal' ? '\n' + URG_TXT[r.urg] : '') + (r.diag ? '\nDiag.: ' + r.diag : ''),
      (r.prof || 'Instructor') + (r.origen === 'gerencia' && r.area ? '\n' + r.area : r.clase ? '\n' + r.clase : ''),
      (r.estado === 'resuelto' ? 'Resuelto' : r.estado === 'atencion' ? 'En proceso' : 'Sin atender') + (r.resuelto ? '\n' + fechaHora(r.resuelto) : '') + (r.cerrada ? '\nCerrado' : ''),
      infTec(r) || '—',
      resp != null ? durCorta(resp) : '—',
      tot != null ? durCorta(tot) : 'En curso\n' + durCorta(now() - r.creado),
      (cp || '—') + arr(r.piezas).map(function(x){ return '\n' + x.desc + (x.llego ? ' · esperó ' + durCorta(x.llego - x.pedida) : ' · esperando'); }).join('') + (r.costo ? '\n$' + r.costo : '')
    ]);
    s.sem.push(semaforo(r));
  });
  return s;
}
function infSecPrev(titulo, l){
  var s = { t:titulo, cols:[{ t:'Revisión', w:26 }, { t:'Lugar', w:14 }, { t:'Frecuencia', w:10 }, { t:'Programada', w:13 }, { t:'Situación', w:15 }, { t:'Posposiciones', w:22 }], filas:[], sem:[] };
  l.forEach(function(p){
    var d = diasPrev(p), pp = arr(p.posp), h = arr(p.hist), ult = h.length ? Math.max.apply(null, h) : 0;
    s.filas.push([
      p.titulo + (p.detalle ? '\n' + p.detalle : ''),
      p.salonId ? salonById(p.salonId).nombre : '—',
      'Cada ' + plu(p.freq, 'día', 'días'),
      fFecha(p.proxima),
      (d < 0 ? 'Vencido hace ' + plu(-d, 'día', 'días') : d === 0 ? 'Toca hoy' : d === 1 ? 'Mañana' : 'En ' + d + ' días') + (ult ? '\nÚltima: ' + fFecha(ult) : '\nSin revisiones'),
      pp.length ? plu(pp.length, 'vez', 'veces') + '\nÚltimo motivo: ' + (pp[pp.length - 1].motivo || '—') : 'Ninguna'
    ]);
    s.sem.push(d < 0 ? 'rojo' : d === 0 ? 'amar' : '');
  });
  return s;
}
function infSecHechos(titulo, l){
  var s = { t:titulo, cols:[{ t:'Revisión', w:36 }, { t:'Lugar', w:20 }, { t:'Realizada', w:18 }, { t:'Frecuencia', w:12 }, { t:'Próxima', w:14 }], filas:[], sem:[] };
  l.forEach(function(x){
    var p = x.p;
    s.filas.push([p.titulo + (p.detalle ? '\n' + p.detalle : ''), p.salonId ? salonById(p.salonId).nombre : '—', fechaHora(x.ts) + '\n' + fFecha(x.ts), 'Cada ' + plu(p.freq, 'día', 'días'), fFecha(p.proxima)]);
    s.sem.push('verde');
  });
  return s;
}

/* ---------- resumen (indicadores del informe) ---------- */
function infProm(a){ return a.length ? a.reduce(function(n, x){ return n + x; }, 0) / a.length : null; }
function infKpisRep(l){
  var res = l.filter(function(r){ return r.estado === 'resuelto'; }).length;
  var resp = infProm(l.map(infRespMs).filter(function(x){ return x != null; }));
  var tot = infProm(l.map(infTotMs).filter(function(x){ return x != null; }));
  var mx = l.slice().sort(function(a, b){ return infDurMs(b) - infDurMs(a); })[0];
  var comp = l.filter(function(r){ return r.compra || r.cambio; }), costo = comp.reduce(function(n, r){ return n + (parseFloat(r.costo) || 0); }, 0);
  var urg = l.filter(function(r){ return r.urg && r.urg !== 'normal'; }).length;
  return [
    ['Reportes', String(l.length), res + ' resueltos · ' + (l.length - res) + ' pendientes'],
    ['Respuesta promedio', resp != null ? durCorta(resp) : '—', 'en abrir el reporte'],
    ['Solución promedio', tot != null ? durCorta(tot) : '—', 'de que llegó a resolverse'],
    ['Tardó más', mx ? durCorta(infDurMs(mx)) : '—', mx ? eqById(mx.equipoId).nombre : 'sin reportes'],
    ['Compra o cambio', String(comp.length), costo ? 'estimado $' + costo.toLocaleString('es-MX') : 'sin costo capturado'],
    ['Urgentes', String(urg), 'urgentes o fuera de servicio']
  ];
}

/* ---------- el informe completo ---------- */
function infTxtFiltros(c){
  var R = infRango(c), x = [];
  var per = INF_PER.filter(function(p){ return p[0] === c.per; })[0];
  x.push('Periodo: ' + (R ? (fFecha(R.desde) === fFecha(R.hasta) ? fFecha(R.desde) : fFecha(R.desde) + ' al ' + fFecha(R.hasta)) : 'todo el historial') + (c.tipo === 'rep' && c.fechaPor === 'resuelto' && R ? ' (por fecha de resolución)' : ''));
  if (c.tipo === 'rep') {
    var E = { todos:'', nuevo:'Sin atender', atencion:'En proceso', pend:'Pendientes (sin atender y en proceso)', resuelto:'Resueltos' }[c.estado]; if (E) x.push('Estado: ' + E);
    if (c.urg) x.push('Urgencia: ' + URG_TXT[c.urg]);
    if (c.compra) x.push('Solo los que requieren compra o cambio');
  }
  if (c.tipo === 'prev') { var P = { prog:'', todos:'', venc:'Vencidas', posp:'Con posposiciones', hecho:'Revisiones realizadas' }[c.estado]; if (P) x.push(P); }
  if (c.origen) x.push(c.origen === 'fitness' ? 'Solo Fitness' : 'Solo otras áreas de Gerencia');
  if (c.area) x.push('Área: ' + c.area);
  if (c.lugar) x.push('Lugar: ' + c.lugar);
  if (c.tec) x.push('Atendió: ' + c.tec);
  if (c.tipo === 'rep') x.push('Orden: ' + ({ recientes:'más recientes primero', antiguos:'más antiguos primero', mayor:'de mayor a menor tiempo', menor:'de menor a mayor tiempo', equipo:'por equipo', lugar:'por lugar' }[c.orden] || ''));
  return x.join(' · ');
}
function infBuild(c){
  var inf = { titulo:'', sub:infTxtFiltros(c), kpis:[], secs:[], nota:'', tipo:c.tipo }, R = infRango(c);
  if (c.tipo === 'rep') {
    var l = infOrdena(infReps(c), c, c.fechaPor);
    var nom = { nuevo:'Reportes sin atender', atencion:'Reportes en proceso', pend:'Reportes pendientes', resuelto:'Reportes atendidos' }[c.estado] || 'Reportes de mantenimiento';
    inf.titulo = c.compra ? 'Compras o cambios requeridos' : nom;
    inf.kpis = infKpisRep(l); inf.secs.push(infSecRep('Reportes', l));
    inf.nota = 'Respuesta: tiempo que tardó mantenimiento en abrir el reporte. Tiempo total: desde que llegó hasta que se resolvió; los que siguen abiertos aparecen “En curso” al momento de generar el informe.';
  } else if (c.tipo === 'prev') {
    if (c.estado === 'hecho') {
      var h = infPrevHechos(c);
      inf.titulo = 'Revisiones preventivas realizadas'; inf.kpis = [['Revisiones realizadas', String(h.length), 'en el periodo']]; inf.secs.push(infSecHechos('Revisiones realizadas', h));
    } else {
      var p = infPrevs(c), ven = p.filter(function(x){ return diasPrev(x) < 0; }).length, po = p.reduce(function(n, x){ return n + arr(x.posp).length; }, 0);
      inf.titulo = c.estado === 'venc' ? 'Preventivos vencidos' : c.estado === 'posp' ? 'Preventivos pospuestos' : 'Mantenimiento preventivo programado';
      inf.kpis = [['Revisiones', String(p.length), 'en la lista'], ['Vencidas', String(ven), ven ? 'revisión atrasada' : 'al corriente'], ['Posposiciones', String(po), 'veces que se movió una fecha']];
      inf.secs.push(infSecPrev('Revisiones programadas', p));
    }
  } else {                                      // actividad del periodo (el reporte del día)
    var atend = infOrdena(infReps(c, { estado:'resuelto', fechaPor:'resuelto' }), { orden:'recientes' }, 'resuelto');
    var recib = infOrdena(infReps(c, { estado:'todos', fechaPor:'llegada' }), { orden:'antiguos' }, 'llegada');
    var hechos = infPrevHechos(c), uno = R && fFecha(R.desde) === fFecha(R.hasta);
    inf.titulo = c.per === 'hoy' || (uno && fFecha(R.desde) === fFecha(sod(now()))) ? 'Reporte diario de mantenimiento' : uno ? 'Reporte de mantenimiento del ' + fFecha(R.desde) : 'Reporte de actividad de mantenimiento';
    var tot = infProm(atend.map(infTotMs).filter(function(x){ return x != null; }));
    inf.kpis = [['Reportes atendidos', String(atend.length), 'resueltos en el periodo'], ['Reportes recibidos', String(recib.length), 'llegaron en el periodo'], ['Revisiones preventivas', String(hechos.length), 'realizadas en el periodo'],
      ['Solución promedio', tot != null ? durCorta(tot) : '—', 'de los atendidos'], ['Con compra o cambio', String(atend.filter(function(r){ return r.compra || r.cambio; }).length), 'entre los atendidos'], ['Siguen pendientes', String(infRepsAll().filter(function(r){ return r.estado !== 'resuelto'; }).length), 'reportes abiertos ahora']];
    inf.secs.push(infSecRep('Reportes atendidos', atend), infSecRep('Reportes recibidos', recib), infSecHechos('Revisiones preventivas realizadas', hechos));
    inf.nota = 'Atendidos: los que se resolvieron en el periodo, aunque hayan llegado antes. Recibidos: los que llegaron en el periodo, sin importar su estado.';
  }
  inf.n = inf.secs.reduce(function(n, s){ return n + s.filas.length; }, 0);
  return inf;
}

/* ---------- HTML del informe (pantalla e impresión usan el mismo) ---------- */
function infCelda(s){
  var p = String(s == null ? '' : s).split('\n');
  return esc(p[0]) + p.slice(1).map(function(x){ return '<br><small>' + esc(x) + '</small>'; }).join('');
}
function infSecHTML(s){
  var filas = arr(s.filas), cols = arr(s.cols), sem = arr(s.sem);
  if (!filas.length) return '<div class="h2 sm">' + esc(s.t) + ' (0)</div><div class="empty">No hay registros con estos filtros.</div>';
  return '<div class="h2 sm">' + esc(s.t) + ' (' + filas.length + ')</div>' +
    '<table class="doc-tabla mnt-t"><colgroup>' + cols.map(function(c){ return '<col style="width:' + (c.w || 10) + '%">'; }).join('') + '</colgroup>' +
    '<thead><tr>' + cols.map(function(c){ return '<th' + (c.n ? ' class="n"' : '') + '>' + esc(c.t) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    filas.map(function(f, i){
      return '<tr>' + arr(f).map(function(v, j){ return '<td class="' + (j === 0 && sem[i] ? 's-' + sem[i] : '') + (cols[j] && cols[j].n ? ' n' : '') + '">' + infCelda(v) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
}
function infKpisHTML(k){
  k = arr(k).map(arr);
  return '<div class="kpis">' + k.map(function(x){ return '<div class="kpi" style="--kc:var(--g)"><span class="k-l">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b>' + (x[2] ? '<em class="k-c">' + esc(x[2]) + '</em>' : '') + '</div>'; }).join('') + '</div>';
}
function infCuerpo(inf){ return (arr(inf.kpis).length ? infKpisHTML(inf.kpis) : '') + arr(inf.secs).map(infSecHTML).join('') + (inf.nota ? '<p class="an-nota">' + esc(inf.nota) + '</p>' : ''); }

/* ---------- impresión con el membrete (igual que Control Gerencia) ---------- */
var DOC_CSS = '@page{size:letter;margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'html{margin:0!important;padding:0!important;background:#fff!important;background-image:none!important;min-height:0!important}' +
  'body{margin:0!important;padding:0!important;background:transparent!important;background-image:none!important;min-height:0!important;color:#10222b;font-size:11.5px;line-height:1.4}' +
  '.mb-bg{position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1}.mb-t{width:100%;border-collapse:collapse}.mb-t td{padding:0}.mb-sp-h{height:30mm}.mb-sp-f{height:28mm}.mb-b{padding:0 13mm 0 26mm}' +
  '.doc-h{margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #0f7a5a}.doc-h h1{margin:0;font-size:22px;font-weight:700;color:#0a4d3a;letter-spacing:-.01em;line-height:1.15}' +
  '.doc-h p{margin:3px 0 0;font-size:12.5px;color:#334a54}.doc-h small{display:block;margin-top:2px;font-size:10.5px;color:#748792}' +
  '.doc-c .h2{margin:16px 0 8px;font-size:15px;color:#0a4d3a;break-after:avoid}.doc-c .h2.sm{font-size:13px;margin:12px 0 6px}.doc-c .h2::before{height:14px}' +
  '.doc-c .kpi,.doc-c tr{break-inside:avoid}.doc-c .kpi{box-shadow:none!important;background:#fff!important;border:1px solid #cfdad8!important;min-height:0!important;padding:8px 10px!important;border-radius:10px}' +
  '.doc-c .kpis{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:8px!important}.doc-c .kpi b{font-size:22px!important}.doc-c .kpi .k-l{font-size:9.5px}.doc-c .kpi .k-c{font-size:10.5px}' +
  '.doc-c .btn,.doc-c .no-print{display:none!important}' +
  '.doc-c .empty{padding:10px;border:1px dashed #b8c8c5;border-radius:8px;color:#748792;text-align:center;font-size:11px}' +
  '.doc-c .doc-tabla{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0}.doc-c .doc-tabla th{background:#eaf3f1;color:#0a4d3a;text-align:left;padding:5px 7px;font-size:10px;letter-spacing:.05em;text-transform:uppercase}' +
  '.doc-c .doc-tabla td{padding:5px 7px;border-bottom:1px solid #dbe6e4;vertical-align:top}.doc-c .doc-tabla td.n,.doc-c .doc-tabla th.n{text-align:right}' +
  '.doc-c .mnt-t{table-layout:fixed;font-size:8.6px}.doc-c .mnt-t th{font-size:7.6px;padding:4px 4px;letter-spacing:.02em}.doc-c .mnt-t td{padding:4px;word-wrap:break-word;overflow-wrap:anywhere}.doc-c .mnt-t small{display:block;font-size:7.8px;color:#5b6f78;margin-top:1px}' +
  '.doc-c .mnt-t thead{display:table-header-group}.doc-c td.s-rojo{border-left:4px solid #c62d22}.doc-c td.s-amar{border-left:4px solid #e0a100}.doc-c td.s-verde{border-left:4px solid #0f9d74}' +
  '.doc-c .an-nota{font-size:9.5px;color:#748792;margin-top:14px}' +
  '.doc-c .doc-firmas{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:38px;break-inside:avoid}.doc-c .doc-firmas div{border-top:1px solid #334a54;padding-top:4px;text-align:center;font-size:10.5px;color:#334a54}';
function docEstilos(){
  return [].slice.call(document.querySelectorAll('link[rel=stylesheet],style')).map(function(n){ var c = n.cloneNode(true); if (c.tagName === 'LINK') c.removeAttribute('media'); return c.outerHTML; }).join('\n');
}
function infDocHTML(inf){
  var fecha = new Date(inf.creado || now()).toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(inf.titulo) + '</title>' + docEstilos() + '<style>' + DOC_CSS + '</style></head><body>' +
    '<img class="mb-bg" src="img/membrete.png" alt=""><table class="mb-t"><thead><tr><td><div class="mb-sp-h"></div></td></tr></thead><tbody><tr><td><div class="mb-b">' +
    '<div class="doc-h"><h1>' + esc(inf.titulo) + '</h1>' + (inf.sub ? '<p>' + esc(inf.sub) + '</p>' : '') + '<small>Club Campestre Aguascalientes · Mantenimiento · generado el ' + esc(fecha) + (inf.por ? ' por ' + esc(inf.por) : '') + '</small></div>' +
    '<div class="doc-c">' + infCuerpo(inf) + '<div class="doc-firmas"><div>Mantenimiento</div><div>Gerencia deportiva</div></div></div>' +
    '</div></td></tr></tbody><tfoot><tr><td><div class="mb-sp-f"></div></td></tr></tfoot></table></body></html>';
}
function infImprimeDirecto(inf){
  var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  var d = f.contentDocument; d.open(); d.write(infDocHTML(inf)); d.close();
  var lanzado = false, lanzar = function(){
    if (lanzado) return; lanzado = true;
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('No se pudo abrir la impresión en este navegador'); }
    setTimeout(function(){ if (f.parentNode) f.parentNode.removeChild(f); }, 120000);
  };
  var img = d.querySelector('.mb-bg'), espera = function(){ setTimeout(lanzar, 300); };
  if (!img || img.complete) espera(); else { img.onload = espera; img.onerror = espera; }
  setTimeout(lanzar, 4000);
}
function infEscala(){
  var pv = document.getElementById('docPv'), f = document.getElementById('docFrame'); if (!pv || !f) return;
  var s = Math.min(1, (pv.clientWidth || 560) / 816); f.style.transform = 'scale(' + s + ')'; pv.style.height = Math.round(1056 * s) + 'px';
}
function infMonta(){ var f = document.getElementById('docFrame'); if (!f || !ui.infDoc) return; f.srcdoc = infDocHTML(ui.infDoc); infEscala(); }
window.addEventListener('resize', infEscala);
function sheetInfDoc(){
  return mHead('Reporte con membrete') +
    '<div class="doc-pv" id="docPv"><iframe id="docFrame" title="Vista previa del reporte"></iframe></div>' +
    '<div class="sub" style="margin:10px 0 0">Tamaño carta, con el membrete de Campestre. La vista muestra el inicio; al imprimir se acomoda en páginas. En el cuadro de impresión elige <b>Guardar como PDF</b> para descargarlo.</div>' +
    '<div class="btns"><button class="btn" data-a="close">Cerrar</button><button class="btn primary" data-a="infImprime">Imprimir / guardar PDF</button></div>';
}

/* ---------- pantalla ---------- */
function infOpciones(sel, items, vacio){
  return '<option value="">' + vacio + '</option>' + items.map(function(x){ return '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
}
function infUnicos(a){ return a.filter(function(x, i){ return x && a.indexOf(x) === i; }).sort(function(x, y){ return x.localeCompare(y, 'es', { numeric:true }); }); }
function infChips(c, campo, opts){
  return '<div class="chips">' + opts.map(function(o){ return '<button class="chip' + (c[campo] === o[0] ? ' on' : '') + '" data-a="infSet" data-v="' + campo + ':' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
}
function infFiltrosHTML(c){
  var ests = c.tipo === 'rep' ? [['todos', 'Todos'], ['nuevo', 'Sin atender'], ['atencion', 'En proceso'], ['pend', 'Pendientes'], ['resuelto', 'Resueltos']]
    : c.tipo === 'prev' ? [['prog', 'Programadas'], ['venc', 'Vencidas'], ['posp', 'Pospuestas'], ['hecho', 'Realizadas']] : null;
  var reps = infRepsAll();
  var areas = infUnicos(reps.map(infAreaDe).concat(lista('salones').map(function(s){ return s.area; })));
  var lugares = infUnicos(lista('salones').map(function(s){ return s.nombre; }));
  var tecs = infUnicos(reps.map(infTec));
  var per = INF_PER.filter(function(p){ return c.tipo === 'prev' || (p[0] !== 'p7' && p[0] !== 'p30'); });
  var panel = '';
  if (c.fOpen) {
    panel = '<div class="card inf-fp"><div class="lbl">Qué incluir</div>' + infChips(c, 'tipo', [['rep', 'Reportes de fallas'], ['prev', 'Preventivo'], ['act', 'Actividad del periodo']]) +
      (ests ? '<div class="lbl">Estado</div>' + infChips(c, 'estado', ests) : '') +
      (c.tipo === 'rep' ? '<div class="lbl">Fecha que cuenta</div>' + infChips(c, 'fechaPor', [['llegada', 'Cuando llegó el reporte'], ['resuelto', 'Cuando se resolvió']]) : '') +
      '<div class="two">' +
      (c.tipo === 'rep' ? '<label class="f"><span>Urgencia</span><select data-inf="urg"><option value="">Todas</option>' + ['fuera', 'urgente', 'normal'].map(function(u){ return '<option value="' + u + '"' + (c.urg === u ? ' selected' : '') + '>' + URG_TXT[u] + '</option>'; }).join('') + '</select></label>' : '') +
      (c.tipo !== 'prev' ? '<label class="f"><span>Origen</span><select data-inf="origen"><option value="">Todos</option><option value="fitness"' + (c.origen === 'fitness' ? ' selected' : '') + '>Solo Fitness</option><option value="gerencia"' + (c.origen === 'gerencia' ? ' selected' : '') + '>Otras áreas de Gerencia</option></select></label>' : '') +
      '<label class="f"><span>Área</span><select data-inf="area">' + infOpciones(c.area, areas, 'Todas') + '</select></label>' +
      '<label class="f"><span>Lugar</span><select data-inf="lugar">' + infOpciones(c.lugar, lugares, 'Todos') + '</select></label>' +
      (c.tipo !== 'prev' ? '<label class="f"><span>Atendió</span><select data-inf="tec">' + infOpciones(c.tec, tecs, 'Cualquiera') + '</select></label>' : '') +
      (c.tipo === 'rep' ? '<label class="f"><span>Ordenar</span><select data-inf="orden">' + [['recientes', 'Más recientes primero'], ['antiguos', 'Más antiguos primero'], ['mayor', 'Más tiempo primero'], ['menor', 'Menos tiempo primero'], ['equipo', 'Por equipo'], ['lugar', 'Por lugar']].map(function(o){ return '<option value="' + o[0] + '"' + (c.orden === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' : '') +
      '</div>' + (c.tipo === 'rep' ? '<label class="chk"><input type="checkbox" data-inf="compra"' + (c.compra ? ' checked' : '') + '> Solo los que necesitan compra o cambio</label>' : '') + '</div>';
  }
  return '<div class="chips">' + per.map(function(p){ return '<button class="chip' + (c.per === p[0] ? ' on' : '') + '" data-a="infPer" data-v="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
    '<div class="two inf-fechas"><label class="f"><span>Desde</span><input type="date" data-inf="desde" value="' + esc(c.desde) + '"></label><label class="f"><span>Hasta</span><input type="date" data-inf="hasta" value="' + esc(c.hasta) + '"></label></div>' +
    '<button class="btn sm" data-a="infFiltros">' + (c.fOpen ? 'Ocultar filtros' : 'Más filtros') + '</button>' + panel;
}
function vInforme(){
  var c = ui.inf.cfg, inf = infBuild(c);
  return '<div class="inf-top"><button class="btn sm" data-a="infVolver">‹ Volver</button><div><b>' + esc(inf.titulo) + '</b><small>' + plu(inf.n, 'renglón', 'renglones') + '</small></div></div>' +
    '<div class="sub">' + esc(inf.sub) + '</div>' + infFiltrosHTML(c) +
    '<div class="btns inf-bt"><button class="btn primary" data-a="infPrev">Imprimir o guardar PDF</button><button class="btn cta" data-a="infEnvia">Enviar a Control Gerencia</button></div>' +
    (inf.kpis.length ? infKpisHTML(inf.kpis).replace('class="kpis"', 'class="kpis inf-k"') : '') +
    '<div class="inf-wrap">' + inf.secs.map(infSecHTML).join('') + '</div>' + (inf.nota ? '<p class="sub inf-nota">' + esc(inf.nota) + '</p>' : '') +
    '<div class="sub">En “Todo el historial” se incluyen los últimos reportes ya cerrados por los instructores (hasta 200).</div>';
}
function infKpiBtn(k, label, value, cap, o){
  return '<button class="kpi kpi-btn" data-a="infKpi" data-v="' + k + '" style="--kc:' + (o.color || 'var(--g)') + '" aria-label="' + esc(label) + ': ver la lista"><span class="k-l">' + label + '</span><b class="' + (o.cls || '') + '">' + value + '</b>' + (cap ? '<em class="k-c">' + cap + '</em>' : '') + '<span class="k-go" aria-hidden="true">' + ic('next') + '</span></button>';
}
function infEnviadosHTML(){
  var l = lista('informes').sort(function(a, b){ return b.creado - a.creado; });
  return '<div class="h2">Enviados a Control Gerencia</div>' + (l.length ? '<div class="stack">' + l.map(function(x){
    return '<div class="card"><div class="row"><div><b>' + esc(x.titulo) + '</b><small>' + esc(fechaHora(x.creado)) + (x.por ? ' · ' + esc(x.por) : '') + ' · ' + plu(x.n || 0, 'renglón', 'renglones') + '</small>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</div></div>' +
      '<div class="btns" style="margin-top:10px"><button class="btn sm" data-a="infAbre" data-v="' + x.id + '">Ver e imprimir</button><button class="btn sm danger" data-a="infQuita" data-v="' + x.id + '">Quitar de Gerencia</button></div></div>';
  }).join('') + '</div>' : empty('Todavía no has enviado ningún reporte. Genera uno y toca “Enviar a Control Gerencia”.'));
}
function infGeneradorHTML(){
  var ks = ['dia', 'semprev', 'tiempo', 'pend', 'fit', 'hechos'];
  return '<div class="h2">Generar reporte</div><div class="sub">Elige uno rápido o arma el tuyo con fechas y filtros. Se ve en pantalla, se imprime y se puede mandar a Control Gerencia.</div>' +
    '<div class="inf-rap">' + ks.map(function(k){ return '<button class="btn" data-a="infKpi" data-v="' + k + '">' + esc(INF_RAP[k].t) + '</button>'; }).join('') + '<button class="btn primary" data-a="infNuevo">Armar mi reporte…</button></div>';
}

/* ---------- acciones ---------- */
Object.assign(A, {
  infKpi:function(k){ ui.inf = { cfg:infCfg(INF_RAP[k].o) }; render(); top0(); },
  infNuevo:function(){ ui.inf = { cfg:infCfg({ fOpen:true }) }; render(); top0(); },
  infVolver:function(){ ui.inf = null; render(); top0(); },
  infFiltros:function(){ ui.inf.cfg.fOpen = !ui.inf.cfg.fOpen; render(); },
  infPer:function(v){ var c = ui.inf.cfg; c.per = v; if (v === 'custom') { c.desde = c.desde || fechaInput(sod(now())); c.hasta = c.hasta || c.desde; } else infFechas(c); render(); },
  infSet:function(v){
    var i = v.indexOf(':'), k = v.slice(0, i), x = v.slice(i + 1), c = ui.inf.cfg;
    c[k] = x;
    if (k === 'tipo') {                                     // cada tipo tiene sus propios estados y periodos
      c.estado = x === 'prev' ? 'prog' : 'todos'; if (x === 'act' && (c.per === 'p7' || c.per === 'p30' || c.per === 'all')) { c.per = 'hoy'; infFechas(c); }
      if (x !== 'prev' && (c.per === 'p7' || c.per === 'p30')) { c.per = '30'; infFechas(c); }
    }
    render();
  },
  infPrev:function(){ var inf = infBuild(ui.inf.cfg); inf.creado = now(); inf.por = nombreTec(); ui.infDoc = inf; ui.sheet = { k:'infdoc' }; render(); },
  infImprime:function(){ if (ui.infDoc) infImprimeDirecto(ui.infDoc); },
  infEnvia:function(){
    var inf = infBuild(ui.inf.cfg);
    if (!inf.n) return toast('No hay registros que enviar con estos filtros');
    if (inf.n > INF_MAX) return toast('Son ' + inf.n + ' renglones; acota las fechas (máximo ' + INF_MAX + ')');
    if (!db) return toast('Sin conexión con la base de datos');
    var id = nuevoId('informes');
    var o = { titulo:inf.titulo, sub:inf.sub, tipo:inf.tipo, nota:inf.nota, kpis:inf.kpis, secs:inf.secs.filter(function(s){ return s.filas.length; }).map(function(s){ return { t:s.t, cols:s.cols, filas:s.filas, sem:s.sem.map(function(x){ return x || ''; }) }; }), n:inf.n, creado:now(), por:nombreTec() };
    db.ref('informes/' + id).set(o).then(function(){ toast('Enviado a Control Gerencia'); }).catch(function(e){ toast('No se pudo enviar: ' + ((e && e.message) || '')); });
  },
  infAbre:function(v){ var x = (DB.informes || {})[v]; if (!x) return; ui.infDoc = Object.assign({ id:v }, x); ui.sheet = { k:'infdoc' }; render(); },
  infQuita:function(v){ if (!confirm('¿Quitar este reporte de Control Gerencia? Ya no lo podrán abrir allá.')) return; guarda('informes/' + v, null); toast('Quitado'); }
});
(function(){
  var t0 = A.tab; A.tab = function(v){ ui.inf = null; t0(v); };
  var c0 = A.close; A.close = function(){ ui.infDoc = null; c0(); };
})();
document.addEventListener('change', function(e){
  var t = e.target, k = t && t.getAttribute && t.getAttribute('data-inf'); if (!k || !ui.inf) return;
  var c = ui.inf.cfg; c[k] = t.type === 'checkbox' ? t.checked : t.value;
  if (k === 'desde' || k === 'hasta') { c.per = 'custom'; if (!c.desde) c.desde = c.hasta; if (!c.hasta) c.hasta = c.desde; if (c.hasta < c.desde) { if (k === 'desde') c.hasta = c.desde; else c.desde = c.hasta; } }
  render();
});
