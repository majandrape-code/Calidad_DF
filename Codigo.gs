// ==========================================
// CONFIGURACION DE RECURSOS EXTERNOS
// ==========================================
// En cada despliegue se pueden definir estas claves en:
// Configuracion del proyecto > Propiedades de la secuencia de comandos.
// Los valores actuales se mantienen como respaldo para no afectar el entorno
// existente mientras se completa la configuracion externa.
var CONFIG_KEYS = {
  TRAZABILIDAD_FOLDER_ID: 'TRAZABILIDAD_FOLDER_ID',
  GOBIERNO_SHEET_ID:      'GOBIERNO_SHEET_ID',
  CALIDAD_SHEET_ID:       'CALIDAD_SHEET_ID',
  CACHE_TRAZABILIDAD_SEGUNDOS: 'CACHE_TRAZABILIDAD_SEGUNDOS',
  CACHE_GOBIERNO_SEGUNDOS:     'CACHE_GOBIERNO_SEGUNDOS',
  CACHE_CALIDAD_SEGUNDOS:      'CACHE_CALIDAD_SEGUNDOS',
  ADMIN_EMAILS:                 'ADMIN_EMAILS',
  CACHE_VERSION:               'CACHE_VERSION'
};

var CONFIG_DEFAULTS = {
  TRAZABILIDAD_FOLDER_ID: '110ItOvnTEV8utsL3YuyZdbBT5XNgBlnN',
  GOBIERNO_SHEET_ID:      '1OZJ-2K1RJ_0zKwL4xHsL2C9bEPaMIuccV5hlhenzY6Y',
  CALIDAD_SHEET_ID:       '1a3voha6FYHgUZA3FoPltX77WFZF-Whp4x08b8no96V8',
  CACHE_TRAZABILIDAD_SEGUNDOS: 300,
  CACHE_GOBIERNO_SEGUNDOS:     600,
  CACHE_CALIDAD_SEGUNDOS:      600
};

var OPERACIONES_KEY = 'CALIDAD_OPERACIONES_RECIENTES';
var CONEXIONES_KEY = 'CALIDAD_CONEXIONES_RECIENTES';
var MAX_OPERACIONES = 15;
var MAX_CONEXIONES = 50;

function enteroEnRango_(valor, defecto, minimo, maximo) {
  var numero = parseInt(valor, 10);
  if (isNaN(numero)) numero = defecto;
  return Math.max(minimo, Math.min(maximo, numero));
}

function obtenerConfiguracion_() {
  var propiedades = {};
  try {
    propiedades = PropertiesService.getScriptProperties().getProperties();
  } catch (e) {
    console.warn('No se pudieron leer las propiedades del proyecto; se usaran los valores de respaldo.');
  }

  return {
    trazabilidadFolderId: propiedades[CONFIG_KEYS.TRAZABILIDAD_FOLDER_ID] || CONFIG_DEFAULTS.TRAZABILIDAD_FOLDER_ID,
    gobiernoSheetId:      propiedades[CONFIG_KEYS.GOBIERNO_SHEET_ID]      || CONFIG_DEFAULTS.GOBIERNO_SHEET_ID,
    calidadSheetId:       propiedades[CONFIG_KEYS.CALIDAD_SHEET_ID]       || CONFIG_DEFAULTS.CALIDAD_SHEET_ID,
    cacheTrazabilidadSegundos: enteroEnRango_(
      propiedades[CONFIG_KEYS.CACHE_TRAZABILIDAD_SEGUNDOS],
      CONFIG_DEFAULTS.CACHE_TRAZABILIDAD_SEGUNDOS, 60, 21600),
    cacheGobiernoSegundos: enteroEnRango_(
      propiedades[CONFIG_KEYS.CACHE_GOBIERNO_SEGUNDOS],
      CONFIG_DEFAULTS.CACHE_GOBIERNO_SEGUNDOS, 60, 21600),
    cacheCalidadSegundos: enteroEnRango_(
      propiedades[CONFIG_KEYS.CACHE_CALIDAD_SEGUNDOS],
      CONFIG_DEFAULTS.CACHE_CALIDAD_SEGUNDOS, 60, 21600),
    cacheVersion: propiedades[CONFIG_KEYS.CACHE_VERSION] || '1'
  };
}

function claveCache_(prefijo, partes) {
  var config = obtenerConfiguracion_();
  return [prefijo, 'v' + config.cacheVersion].concat(partes || []).join('_');
}

function emailActivo_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function emailsAdministradores_() {
  var valor = '';
  try {
    valor = PropertiesService.getScriptProperties().getProperty(CONFIG_KEYS.ADMIN_EMAILS) || '';
  } catch (e) {}
  return valor.split(',').map(function(email) {
    return email.trim().toLowerCase();
  }).filter(function(email) { return !!email; });
}

// Si aún no existe una lista, el primer usuario identificado que abre
// Administración queda registrado. Las siguientes altas se gestionan desde
// la propiedad ADMIN_EMAILS para no confiar en datos enviados por el cliente.
function esAdministradorActual_() {
  var email = emailActivo_();
  if (!email) return false;
  var administradores = emailsAdministradores_();
  if (administradores.length > 0) return administradores.indexOf(email) !== -1;

  var lock = LockService.getScriptLock();
  var bloqueado = false;
  try {
    lock.waitLock(5000);
    bloqueado = true;
    administradores = emailsAdministradores_();
    if (administradores.length === 0) {
      PropertiesService.getScriptProperties().setProperty(CONFIG_KEYS.ADMIN_EMAILS, email);
      return true;
    }
    return administradores.indexOf(email) !== -1;
  } catch (e) {
    throw new Error('No se pudo comprobar el acceso de administración. Prueba de nuevo.');
  } finally {
    if (bloqueado) {
      try { lock.releaseLock(); } catch (eRelease) {}
    }
  }
}

function requerirAdministrador_() {
  if (!esAdministradorActual_()) {
    throw new Error('No tienes permisos para abrir la Administración de Calidad.');
  }
  return emailActivo_();
}

function leerJsonPropiedad_(clave, defecto) {
  try {
    var valor = PropertiesService.getScriptProperties().getProperty(clave);
    return valor ? JSON.parse(valor) : defecto;
  } catch (e) {
    return defecto;
  }
}

function registrarOperacion_(accion, recurso, estado, inicioMs, detalle) {
  var ahora = new Date();
  var entrada = {
    fecha: ahora.toISOString(),
    usuario: emailActivo_() || 'usuario-no-identificado',
    accion: String(accion || 'operacion'),
    recurso: String(recurso || 'aplicacion'),
    estado: estado === 'error' ? 'error' : 'ok',
    duracionMs: Math.max(0, Date.now() - Number(inicioMs || Date.now())),
    detalle: String(detalle || '').slice(0, 240)
  };
  console.log(JSON.stringify({ tipo: 'CALIDAD_OPERACION', datos: entrada }));

  var lock = LockService.getScriptLock();
  var bloqueado = false;
  try {
    lock.waitLock(3000);
    bloqueado = true;
    var operaciones = leerJsonPropiedad_(OPERACIONES_KEY, []);
    if (!Array.isArray(operaciones)) operaciones = [];
    operaciones.push(entrada);
    PropertiesService.getScriptProperties().setProperty(
      OPERACIONES_KEY, JSON.stringify(operaciones.slice(-MAX_OPERACIONES)));
  } catch (e) {
    console.warn('No se pudo conservar el historial operativo: ' + e.message);
  } finally {
    if (bloqueado) {
      try { lock.releaseLock(); } catch (eRelease) {}
    }
  }
  return entrada;
}

function ejecutarConRegistro_(accion, recurso, fn) {
  var inicio = Date.now();
  try {
    var resultado = fn();
    registrarOperacion_(accion, recurso, 'ok', inicio, 'Operación completada');
    return resultado;
  } catch (e) {
    registrarOperacion_(accion, recurso, 'error', inicio, e && e.message ? e.message : e);
    throw e;
  }
}

function abrirSpreadsheetConfigurado_(id, descripcion) {
  if (!id) throw new Error('Falta configurar el recurso: ' + descripcion + '.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('No se pudo abrir ' + descripcion + '. Verifica su ID y los permisos del despliegue. Detalle: ' + e.message);
  }
}

function obtenerHojaConfigurada_(spreadsheet, nombreHoja, descripcion) {
  var hoja = spreadsheet.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error('No se encontro la hoja "' + nombreHoja + '" en ' + descripcion + '.');
  }
  return hoja;
}

function abrirCarpetaConfigurada_(id, descripcion) {
  if (!id) throw new Error('Falta configurar el recurso: ' + descripcion + '.');
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('No se pudo abrir ' + descripcion + '. Verifica su ID y los permisos del despliegue. Detalle: ' + e.message);
  }
}

function validarCabeceras_(indices, nombresPorClave, descripcion) {
  var faltantes = [];
  for (var clave in nombresPorClave) {
    if (indices[clave] === -1) faltantes.push(nombresPorClave[clave]);
  }
  if (faltantes.length > 0) {
    throw new Error('Faltan columnas requeridas en ' + descripcion + ': ' + faltantes.join(', ') + '.');
  }
}

function doGet() {
  var email = Session.getActiveUser().getEmail() || "";
  var initials = "US";
  if (email) {
    var parts = email.split('@')[0].split('.');
    if (parts.length > 1) {
      initials = (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    } else {
      initials = parts[0].substring(0, 2).toUpperCase();
    }
  }
  var template = HtmlService.createTemplateFromFile('Index');
  template.userInitials = initials;
  return template.evaluate()
    .setTitle('Data Factory - Trazabilidad Total')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// ADMINISTRACION, SALUD Y ACTIVIDAD
// ==========================================

function extraerIdDrive_(valor) {
  var texto = String(valor || '').trim();
  var match = texto.match(/\/(?:d|folders)\/([a-zA-Z0-9_-]+)/);
  var id = match ? match[1] : texto;
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    throw new Error('La ruta o ID de Google Drive no es válido.');
  }
  return id;
}

function registrarConexionUsuario() {
  var email = emailActivo_();
  if (!email) {
    throw new Error('Google no informó la identidad del usuario. Revisa la política de ejecución del despliegue.');
  }

  var cacheUsuario = CacheService.getUserCache();
  if (cacheUsuario.get('conexion-registrada')) {
    return { email: email, registrada: true };
  }

  var lock = LockService.getScriptLock();
  var bloqueado = false;
  try {
    lock.waitLock(5000);
    bloqueado = true;
    var conexiones = leerJsonPropiedad_(CONEXIONES_KEY, {});
    if (!conexiones || Array.isArray(conexiones)) conexiones = {};
    conexiones[email] = { email: email, ultimaConexion: new Date().toISOString() };

    var ordenadas = Object.keys(conexiones).map(function(clave) {
      return conexiones[clave];
    }).sort(function(a, b) {
      return String(b.ultimaConexion).localeCompare(String(a.ultimaConexion));
    }).slice(0, MAX_CONEXIONES);
    var limitadas = {};
    ordenadas.forEach(function(item) { limitadas[item.email] = item; });
    PropertiesService.getScriptProperties().setProperty(CONEXIONES_KEY, JSON.stringify(limitadas));
    cacheUsuario.put('conexion-registrada', '1', 300);
    return { email: email, registrada: true };
  } finally {
    if (bloqueado) {
      try { lock.releaseLock(); } catch (eRelease) {}
    }
  }
}

function ultimaOperacionPorRecurso_(operaciones, recurso) {
  for (var i = operaciones.length - 1; i >= 0; i--) {
    if (operaciones[i].recurso === recurso) return operaciones[i];
  }
  return null;
}

function metadataArchivo_(id) {
  var archivo = DriveApp.getFileById(id);
  return {
    nombre: archivo.getName(),
    ultimaModificacion: archivo.getLastUpdated().toISOString(),
    url: archivo.getUrl()
  };
}

function diagnosticarConfiguracion_(config, registrar) {
  var inicio;
  var recursos = [];
  var archivosTrazabilidad = [];

  inicio = Date.now();
  try {
    var carpeta = DriveApp.getFolderById(config.trazabilidadFolderId);
    var archivos = carpeta.getFilesByType(MimeType.PLAIN_TEXT);
    while (archivos.hasNext()) {
      var archivo = archivos.next();
      archivosTrazabilidad.push({
        nombre: archivo.getName(),
        ultimaModificacion: archivo.getLastUpdated().toISOString(),
        bytes: archivo.getSize()
      });
    }
    archivosTrazabilidad.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });
    recursos.push({
      clave: 'trazabilidad', etiqueta: 'Carpeta de trazabilidad', tipo: 'Carpeta Drive',
      estado: 'ok', nombre: carpeta.getName(), url: carpeta.getUrl(),
      detalle: archivosTrazabilidad.length + ' archivos TXT disponibles'
    });
    if (registrar) registrarOperacion_('probar_conexion', 'trazabilidad', 'ok', inicio, carpeta.getName());
  } catch (eTrazabilidad) {
    recursos.push({
      clave: 'trazabilidad', etiqueta: 'Carpeta de trazabilidad', tipo: 'Carpeta Drive',
      estado: 'error', nombre: '', url: '', detalle: eTrazabilidad.message
    });
    if (registrar) registrarOperacion_('probar_conexion', 'trazabilidad', 'error', inicio, eTrazabilidad.message);
  }

  inicio = Date.now();
  try {
    var gobierno = SpreadsheetApp.openById(config.gobiernoSheetId);
    obtenerHojaConfigurada_(gobierno, 'Guía de tablas', 'el Google Sheet de gobierno');
    var metaGobierno = metadataArchivo_(config.gobiernoSheetId);
    recursos.push({
      clave: 'gobierno', etiqueta: 'Catálogo de gobierno', tipo: 'Google Sheet',
      estado: 'ok', nombre: gobierno.getName(), url: gobierno.getUrl(),
      ultimaModificacion: metaGobierno.ultimaModificacion,
      detalle: 'Hoja “Guía de tablas” disponible'
    });
    if (registrar) registrarOperacion_('probar_conexion', 'gobierno', 'ok', inicio, gobierno.getName());
  } catch (eGobierno) {
    recursos.push({
      clave: 'gobierno', etiqueta: 'Catálogo de gobierno', tipo: 'Google Sheet',
      estado: 'error', nombre: '', url: '', detalle: eGobierno.message
    });
    if (registrar) registrarOperacion_('probar_conexion', 'gobierno', 'error', inicio, eGobierno.message);
  }

  inicio = Date.now();
  try {
    var calidad = SpreadsheetApp.openById(config.calidadSheetId);
    obtenerHojaConfigurada_(calidad, 'calidad', 'el Google Sheet de calidad');
    var metaCalidad = metadataArchivo_(config.calidadSheetId);
    recursos.push({
      clave: 'calidad', etiqueta: 'Matriz de calidad', tipo: 'Google Sheet',
      estado: 'ok', nombre: calidad.getName(), url: calidad.getUrl(),
      ultimaModificacion: metaCalidad.ultimaModificacion,
      detalle: 'Hoja “calidad” disponible'
    });
    if (registrar) registrarOperacion_('probar_conexion', 'calidad', 'ok', inicio, calidad.getName());
  } catch (eCalidad) {
    recursos.push({
      clave: 'calidad', etiqueta: 'Matriz de calidad', tipo: 'Google Sheet',
      estado: 'error', nombre: '', url: '', detalle: eCalidad.message
    });
    if (registrar) registrarOperacion_('probar_conexion', 'calidad', 'error', inicio, eCalidad.message);
  }

  return { recursos: recursos, archivosTrazabilidad: archivosTrazabilidad };
}

function flujoAplicacion_() {
  return {
    entradas: [
      { clave: 'trazabilidad', nombre: 'Relaciones técnicas', formato: 'TXT', uso: 'Linaje origen → destino' },
      { clave: 'gobierno', nombre: 'Guía de tablas', formato: 'Google Sheet', uso: 'Catálogo, responsables, estados, procesos y TTM' },
      { clave: 'calidad', nombre: 'Matriz de calidad', formato: 'Google Sheet', uso: 'Reglas, resultados, volúmenes y cortes' }
    ],
    procesos: [
      'Normalización y validación de cabeceras',
      'Cruce de calidad, gobierno y trazabilidad',
      'Cálculo de estado, histórico y estabilidad'
    ],
    salidas: [
      { nombre: 'Monitor de calidad', destino: 'Pantalla de la aplicación' },
      { nombre: 'Mapa de trazabilidad', destino: 'Pantalla y descarga CSV' },
      { nombre: 'Reporte de tablas fuente', destino: 'Google Sheet + correo del usuario' },
      { nombre: 'Reporte de tablas destino', destino: 'Google Sheet + correo del usuario' },
      { nombre: 'Reporte de tablas sin TXT', destino: 'Google Sheet + correo del usuario' }
    ]
  };
}

function construirPanelAdministracion_(probarConexiones) {
  var email = requerirAdministrador_();
  var config = obtenerConfiguracion_();
  var operaciones = leerJsonPropiedad_(OPERACIONES_KEY, []);
  if (!Array.isArray(operaciones)) operaciones = [];
  var conexionesMap = leerJsonPropiedad_(CONEXIONES_KEY, {});
  var ahora = Date.now();
  var conexiones = Object.keys(conexionesMap || {}).map(function(clave) {
    var item = conexionesMap[clave];
    var ultima = new Date(item.ultimaConexion).getTime();
    return {
      email: item.email,
      ultimaConexion: item.ultimaConexion,
      activa: !isNaN(ultima) && ahora - ultima <= 15 * 60 * 1000
    };
  }).sort(function(a, b) {
    return String(b.ultimaConexion).localeCompare(String(a.ultimaConexion));
  });

  var diagnostico = probarConexiones
    ? diagnosticarConfiguracion_(config, true)
    : { recursos: [
        { clave: 'trazabilidad', etiqueta: 'Carpeta de trazabilidad', tipo: 'Carpeta Drive', estado: 'sin-probar' },
        { clave: 'gobierno', etiqueta: 'Catálogo de gobierno', tipo: 'Google Sheet', estado: 'sin-probar' },
        { clave: 'calidad', etiqueta: 'Matriz de calidad', tipo: 'Google Sheet', estado: 'sin-probar' }
      ], archivosTrazabilidad: [] };

  if (probarConexiones) {
    operaciones = leerJsonPropiedad_(OPERACIONES_KEY, []);
    if (!Array.isArray(operaciones)) operaciones = [];
  }

  diagnostico.recursos.forEach(function(recurso) {
    recurso.ultimaOperacion = ultimaOperacionPorRecurso_(operaciones, recurso.clave);
  });

  return {
    usuario: { email: email, administrador: true },
    configuracion: {
      trazabilidadFolderId: config.trazabilidadFolderId,
      gobiernoSheetId: config.gobiernoSheetId,
      calidadSheetId: config.calidadSheetId,
      cacheTrazabilidadSegundos: config.cacheTrazabilidadSegundos,
      cacheGobiernoSegundos: config.cacheGobiernoSegundos,
      cacheCalidadSegundos: config.cacheCalidadSegundos,
      cacheVersion: config.cacheVersion
    },
    recursos: diagnostico.recursos,
    archivosTrazabilidad: diagnostico.archivosTrazabilidad,
    conexiones: conexiones,
    operaciones: operaciones.slice().reverse(),
    flujo: flujoAplicacion_()
  };
}

function obtenerPanelAdministracion() {
  return construirPanelAdministracion_(false);
}

function probarConexionesAdministracion() {
  return construirPanelAdministracion_(true);
}

function incrementarVersionCache_() {
  var props = PropertiesService.getScriptProperties();
  var actual = parseInt(props.getProperty(CONFIG_KEYS.CACHE_VERSION), 10);
  var siguiente = isNaN(actual) ? 2 : actual + 1;
  props.setProperty(CONFIG_KEYS.CACHE_VERSION, String(siguiente));
  return siguiente;
}

function guardarConfiguracionAdministracion(configCliente) {
  requerirAdministrador_();
  var candidato = {
    trazabilidadFolderId: extraerIdDrive_(configCliente && configCliente.trazabilidadFolderId),
    gobiernoSheetId: extraerIdDrive_(configCliente && configCliente.gobiernoSheetId),
    calidadSheetId: extraerIdDrive_(configCliente && configCliente.calidadSheetId),
    cacheTrazabilidadSegundos: enteroEnRango_(configCliente && configCliente.cacheTrazabilidadSegundos, 300, 60, 21600),
    cacheGobiernoSegundos: enteroEnRango_(configCliente && configCliente.cacheGobiernoSegundos, 600, 60, 21600),
    cacheCalidadSegundos: enteroEnRango_(configCliente && configCliente.cacheCalidadSegundos, 600, 60, 21600)
  };
  var diagnostico = diagnosticarConfiguracion_(candidato, false);
  var errores = diagnostico.recursos.filter(function(recurso) { return recurso.estado !== 'ok'; });
  if (errores.length > 0) {
    throw new Error('No se guardó la configuración: ' + errores.map(function(recurso) {
      return recurso.etiqueta + ': ' + recurso.detalle;
    }).join(' | '));
  }

  var valores = {};
  valores[CONFIG_KEYS.TRAZABILIDAD_FOLDER_ID] = candidato.trazabilidadFolderId;
  valores[CONFIG_KEYS.GOBIERNO_SHEET_ID] = candidato.gobiernoSheetId;
  valores[CONFIG_KEYS.CALIDAD_SHEET_ID] = candidato.calidadSheetId;
  valores[CONFIG_KEYS.CACHE_TRAZABILIDAD_SEGUNDOS] = String(candidato.cacheTrazabilidadSegundos);
  valores[CONFIG_KEYS.CACHE_GOBIERNO_SEGUNDOS] = String(candidato.cacheGobiernoSegundos);
  valores[CONFIG_KEYS.CACHE_CALIDAD_SEGUNDOS] = String(candidato.cacheCalidadSegundos);
  PropertiesService.getScriptProperties().setProperties(valores, false);
  incrementarVersionCache_();
  registrarOperacion_('guardar_configuracion', 'administracion', 'ok', Date.now(), 'Rutas y frecuencias actualizadas');
  return construirPanelAdministracion_(true);
}

function invalidarCachesAdministracion() {
  requerirAdministrador_();
  var version = incrementarVersionCache_();
  registrarOperacion_('invalidar_cache', 'administracion', 'ok', Date.now(), 'Nueva versión: ' + version);
  return { version: version, mensaje: 'La caché fue invalidada. Las próximas consultas releerán los orígenes.' };
}

// ==========================================
// MÓDULO 1: TRAZABILIDAD Y GOBIERNO
// ==========================================

function obtenerDatosTrazabilidad() {
  var inicio = Date.now();
  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();
  var cacheKey = claveCache_('trazabilidad', [config.trazabilidadFolderId]);
  var datosTrazabilidad = null;
  var origen = 'Drive';
  try {
    var hit = cache.get(cacheKey);
    if (hit) {
      datosTrazabilidad = JSON.parse(hit);
      origen = 'caché';
    }
  } catch (eCache) {}

  try {
    if (!datosTrazabilidad) {
      var carpeta = abrirCarpetaConfigurada_(config.trazabilidadFolderId, 'la carpeta de trazabilidad');
      var archivos = carpeta.getFilesByType(MimeType.PLAIN_TEXT);
      var todasLasRelaciones = [];
      var tablasConArchivoTXT = [];

      while (archivos.hasNext()) {
        var archivo = archivos.next();
        var nombreArchivo = archivo.getName().replace(".txt", "").trim().toLowerCase();
        tablasConArchivoTXT.push(nombreArchivo);
        var contenido = archivo.getBlob().getDataAsString();
        var lineas = contenido.split('\n');
        lineas.forEach(function(linea) {
          if (linea.includes('-->')) {
            var relacion = linea.trim().replace(/\\/g, '');
            if (relacion) todasLasRelaciones.push(relacion);
          }
        });
      }
      datosTrazabilidad = {
        relaciones: todasLasRelaciones,
        archivosTxtExistentes: tablasConArchivoTXT
      };
      try {
        cache.put(cacheKey, JSON.stringify(datosTrazabilidad), config.cacheTrazabilidadSegundos);
      } catch (ePut) {}
    }

    var resultadoExcel = obtenerEstadosYListaTablas();
    registrarOperacion_('leer_datos', 'trazabilidad', 'ok', inicio, 'Origen: ' + origen);
    return {
      relaciones: datosTrazabilidad.relaciones,
      estados: resultadoExcel.mapeoEstados,
      funcionales: resultadoExcel.mapeoFuncional,
      dataScientists: resultadoExcel.mapeoDS,
      dataEngineers: resultadoExcel.mapeoDE,
      listaTablasOficial: resultadoExcel.listaTablas,
      archivosTxtExistentes: datosTrazabilidad.archivosTxtExistentes,
      procesosTablas: resultadoExcel.mapeoProcesos,
      periodicidadTablas: resultadoExcel.mapeoPeriodicidad,
      direccionTablas: resultadoExcel.mapeoDir,
      ttmTablas: resultadoExcel.mapeoTTM
    };
  } catch (e) {
    registrarOperacion_('leer_datos', 'trazabilidad', 'error', inicio, e.message);
    throw e;
  }
}

function obtenerEstadosYListaTablas() {
  // Intentar desde caché primero (10 min TTL)
  var config = obtenerConfiguracion_();
  var cacheKeyGobierno = claveCache_('gobiernoData_v5', [config.gobiernoSheetId]);
  try {
    var cachedGov = CacheService.getScriptCache().get(cacheKeyGobierno);
    if (cachedGov) return JSON.parse(cachedGov);
  } catch(e) {}

  var ss = abrirSpreadsheetConfigurado_(config.gobiernoSheetId, 'el Google Sheet de gobierno');

  // --- Hoja 1: Guía de tablas ---
  var hoja = obtenerHojaConfigurada_(ss, 'Guía de tablas', 'el Google Sheet de gobierno');
  var datos = hoja.getDataRange().getValues();
  
  var mapeoEstados      = {};
  var mapeoFuncional    = {};
  var mapeoDS           = {};
  var mapeoDE           = {};
  var mapeoProcesos     = {};
  var mapeoPeriodicidad = {};
  var mapeoDir          = {};   // col K (índice 10) Guía de tablas
  var mapeoTTM          = {};   // col J (índice 9) Guía de tablas
  var listaTablas       = [];

  for (var i = 1; i < datos.length; i++) {
    var nombreTablaRaw   = datos[i][1];
    var funcionalRaw     = datos[i][2];
    var dataScientistRaw = datos[i][3];
    var dataEngineerRaw  = datos[i][4];
    var periodicidadRaw  = datos[i][6];   // col G
    var estadoRaw        = datos[i][8];
    var ttmRaw           = datos[i][9];   // col J
    var direccionRaw     = datos[i][10];  // col K
    
    var goldContable    = (datos[i][11] && datos[i][11].toString().trim().toUpperCase() === 'Y');
    var goldOperacional = (datos[i][12] && datos[i][12].toString().trim().toUpperCase() === 'Y');
    var flowActividad   = (datos[i][13] && datos[i][13].toString().trim().toUpperCase() === 'Y');
    var ficod           = (datos[i][14] && datos[i][14].toString().trim().toUpperCase() === 'Y');
    var ifrs9           = (datos[i][15] && datos[i][15].toString().trim().toUpperCase() === 'Y');
        
    if (nombreTablaRaw) {
      var nombreLimpio = nombreTablaRaw.toString().trim().replace(/\\/g, '');
      var nombreClave  = nombreLimpio.toLowerCase();
      
      var estadoLimpio = (estadoRaw) ? estadoRaw.toString().trim().toLowerCase() : "desconocido";
      if (estadoLimpio === "n/a" || estadoLimpio === "") estadoLimpio = "desconocido";
      
      var dsVal  = (dataScientistRaw && dataScientistRaw.toString().trim() !== '')
                   ? dataScientistRaw.toString().trim() : "BAU";
      var deVal  = (dataEngineerRaw && dataEngineerRaw.toString().trim() !== '')
                   ? dataEngineerRaw.toString().trim() : "BAU";
      var funcionalVal = (funcionalRaw && funcionalRaw.toString().trim() !== '')
                         ? funcionalRaw.toString().trim() : "BAU";
      var perVal = (periodicidadRaw && periodicidadRaw.toString().trim() !== '')
                   ? periodicidadRaw.toString().trim() : "Diaria";
      var dirVal = (direccionRaw && direccionRaw.toString().trim() !== '')
                   ? direccionRaw.toString().trim() : "Local";

      mapeoEstados[nombreClave]      = estadoLimpio;
      mapeoFuncional[nombreClave]    = funcionalVal;
      mapeoDS[nombreClave]           = dsVal;
      mapeoDE[nombreClave]           = deVal;
      mapeoPeriodicidad[nombreClave] = perVal;
      mapeoDir[nombreClave]          = dirVal;
      if (ttmRaw !== null && ttmRaw !== undefined && ttmRaw.toString().trim() !== '') {
        mapeoTTM[nombreClave] = ttmRaw.toString().trim();
      }
      
      mapeoProcesos[nombreClave] = {
        contable: goldContable, operacional: goldOperacional,
        flow: flowActividad, ficod: ficod, ifrs9: ifrs9
      };
      
      if (listaTablas.indexOf(nombreLimpio) === -1) listaTablas.push(nombreLimpio);
    }
  }

  // --- Hoja 2: DataX Holding to Local ---
  // Gobierno existente: Col A (0)=tabla, G (6)=periodicidad, I (8)=dirección, J (9)=estado.
  // Para TTM: Col B (1)=tabla y Col K (10)=TTM.
  try {
    var hojaHtL = ss.getSheetByName('DataX Holding to Local');
    if (hojaHtL) {
      var datosHtL = hojaHtL.getDataRange().getValues();
      for (var j = 1; j < datosHtL.length; j++) {
        var htlNombreTTMRaw = datosHtL[j][1];
        var htlTTMRaw       = datosHtL[j][10];
        if (htlNombreTTMRaw && htlTTMRaw !== null && htlTTMRaw !== undefined && htlTTMRaw.toString().trim() !== '') {
          var htlClaveTTM = htlNombreTTMRaw.toString().trim().replace(/\\/g, '').toLowerCase();
          // Guía de tablas tiene prioridad; DataX completa únicamente valores ausentes.
          if (!Object.prototype.hasOwnProperty.call(mapeoTTM, htlClaveTTM)) {
            mapeoTTM[htlClaveTTM] = htlTTMRaw.toString().trim();
          }
        }

        var htlNombreRaw = datosHtL[j][0];
        if (!htlNombreRaw) continue;
        var htlNombre = htlNombreRaw.toString().trim().replace(/\\/g, '');
        var htlClave  = htlNombre.toLowerCase();
        var htlEstado = (datosHtL[j][9] && datosHtL[j][9].toString().trim() !== '')
                        ? datosHtL[j][9].toString().trim().toLowerCase() : "desconocido";
        if (htlEstado === "n/a" || htlEstado === "") htlEstado = "desconocido";
        var htlPer = (datosHtL[j][6] && datosHtL[j][6].toString().trim() !== '')
                     ? datosHtL[j][6].toString().trim() : "Diaria";
        var htlDir = (datosHtL[j][8] && datosHtL[j][8].toString().trim() !== '')
                     ? datosHtL[j][8].toString().trim() : "Local";
        var htlDE = (datosHtL[j][4] && datosHtL[j][4].toString().trim() !== '')
                    ? datosHtL[j][4].toString().trim() : "BAU";
        var htlDS = (datosHtL[j][3] && datosHtL[j][3].toString().trim() !== '')
                    ? datosHtL[j][3].toString().trim() : "BAU";
        var htlFuncional = (datosHtL[j][2] && datosHtL[j][2].toString().trim() !== '')
                           ? datosHtL[j][2].toString().trim() : "BAU";

        if (!mapeoEstados[htlClave]) {
          mapeoEstados[htlClave]      = htlEstado;
          mapeoFuncional[htlClave]    = htlFuncional;
          mapeoDS[htlClave]           = htlDS;
          mapeoDE[htlClave]           = htlDE;
          mapeoPeriodicidad[htlClave] = htlPer;
          mapeoDir[htlClave]          = htlDir;
          mapeoProcesos[htlClave]     = { contable: false, operacional: false, flow: false, ficod: false, ifrs9: false };
        } else {
          if (!mapeoPeriodicidad[htlClave] || mapeoPeriodicidad[htlClave] === 'Diaria') {
            mapeoPeriodicidad[htlClave] = htlPer;
          }
          if (!mapeoDir[htlClave] || mapeoDir[htlClave] === 'Local') {
            mapeoDir[htlClave] = htlDir;
          }
          if (!mapeoDE[htlClave] || mapeoDE[htlClave] === 'BAU') {
            mapeoDE[htlClave] = htlDE;
          }
          if (!mapeoDS[htlClave] || mapeoDS[htlClave] === 'BAU') {
            mapeoDS[htlClave] = htlDS;
          }
          if (!mapeoFuncional[htlClave] || mapeoFuncional[htlClave] === 'BAU') {
            mapeoFuncional[htlClave] = htlFuncional;
          }
        }
        if (listaTablas.indexOf(htlNombre) === -1) listaTablas.push(htlNombre);
      }
    }
  } catch(eHtL) { /* hoja no encontrada, continuar */ }

  var resultado = {
    mapeoEstados: mapeoEstados, mapeoFuncional: mapeoFuncional, mapeoDS: mapeoDS, mapeoDE: mapeoDE,
    listaTablas: listaTablas, mapeoProcesos: mapeoProcesos,
    mapeoPeriodicidad: mapeoPeriodicidad, mapeoDir: mapeoDir,
    mapeoTTM: mapeoTTM
  };
  try {
    CacheService.getScriptCache().put(
      cacheKeyGobierno, JSON.stringify(resultado), config.cacheGobiernoSegundos);
  } catch(e) {}
  return resultado;
}

// ==========================================
// OPTIMIZACIÓN: carga inicial unificada
// Devuelve la última fecha disponible + datos de calidad de esa fecha
// en una sola llamada al servidor
// ==========================================

function obtenerCargaInicial() {
  return ejecutarConRegistro_('carga_inicial', 'calidad', function() {
    var config = obtenerConfiguracion_();
    var ss = abrirSpreadsheetConfigurado_(config.calidadSheetId, 'el Google Sheet de calidad');
    var hoja = obtenerHojaConfigurada_(ss, 'calidad', 'el Google Sheet de calidad');
    // Lectura ÚNICA de la hoja: se reutiliza para hallar la última fecha
    // y para procesar sus datos (evita leer Sheets dos veces).
    var datos = leerDatosCalidad_(hoja);

    if (datos.length < 2) return { ultimaFecha: '', datos: [] };

    var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
    var idxFecha = headers.indexOf('gf_cutoff_date');
    if (idxFecha === -1) {
      throw new Error('Falta la columna requerida gf_cutoff_date en la hoja calidad.');
    }

    var ultimaFecha = '';
    for (var i = 1; i < datos.length; i++) {
      var f = formatearFechaSQL(datos[i][idxFecha]);
      if (f && f > ultimaFecha) ultimaFecha = f;
    }

    if (!ultimaFecha) return { ultimaFecha: '', datos: [] };

    var datosCalidad = procesarDatosMonitor(datos, ultimaFecha, '', 'diaria');
    return { ultimaFecha: ultimaFecha, datos: datosCalidad };
  });
}

function enviarPorCorreo(nombreTabla, datosTabla) {
  var inicio = Date.now();
  var userEmail = Session.getActiveUser().getEmail();
  var ssNuevo = SpreadsheetApp.create("Reporte Trazabilidad - " + nombreTabla);
  var fileId = ssNuevo.getId();
  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.EDIT);
  } catch (e) { console.error("Error al configurar permisos: " + e.toString()); }

  var hoja = ssNuevo.getSheets()[0];
  hoja.getRange(1, 1, 1, 4).setValues([["Origen", "Estado Origen", "Destino", "Estado Destino"]])
      .setBackground("#003366").setFontColor("white").setFontWeight("bold");
  if (datosTabla.length > 0) hoja.getRange(2, 1, datosTabla.length, 4).setValues(datosTabla);
  hoja.autoResizeColumns(1, 4);
  var sheetUrl = ssNuevo.getUrl();

  var cuerpoHtml = "<div style='font-family: sans-serif; color: #333; max-width: 800px; margin: 0 auto;'>";
  cuerpoHtml += "<h2 style='color: #003366; border-bottom: 2px solid #f58220; padding-bottom: 10px;'>Trazabilidad Data Factory: " + nombreTabla + "</h2>";
  cuerpoHtml += "<div style='background-color: #f4f7f9; border-left: 4px solid #f58220; padding: 15px; margin: 20px 0;'>";
  cuerpoHtml += "<p style='margin: 0 0 10px 0; font-weight: bold; color: #003366;'>📊 Reporte en la nube disponible:</p>";
  cuerpoHtml += "<p style='margin: 0;'>Accede al detalle aquí: <a href='" + sheetUrl + "' style='color: #f58220; font-weight: bold; text-decoration: underline;'>Abrir Google Sheet Corporativo</a></p>";
  cuerpoHtml += "<p style='margin: 5px 0 0 0; font-size: 0.85rem; color: #666;'>* Configurado con acceso de edición abierto para todo el dominio de BBVA (no requiere solicitar permisos).</p>";
  cuerpoHtml += "</div>";
  cuerpoHtml += "<table style='border-collapse: collapse; width: 100%; border: 1px solid #ddd; margin-top: 20px;'>";
  cuerpoHtml += "<tr style='background-color: #003366; color: white;'><th style='padding: 10px; text-align: left;'>Origen</th><th style='padding: 10px; text-align: center; width: 140px;'>Estado Origen</th><th style='padding: 10px; text-align: left;'>Destino</th><th style='padding: 10px; text-align: center; width: 140px;'>Estado Destino</th></tr>";
  datosTabla.forEach(function(f) {
    var stO = f[1].toLowerCase(), stD = f[3].toLowerCase();
    var cO = (stO === "productiva") ? "#c8e6c9" : (stO === "en desarrollo" ? "#ffcdd2" : "#e0e0e0");
    var cD = (stD === "productiva") ? "#c8e6c9" : (stD === "en desarrollo" ? "#ffcdd2" : "#e0e0e0");
    var tO = (stO === "productiva") ? "#2e7d32" : (stO === "en desarrollo" ? "#b71c1c" : "#616161");
    var tD = (stD === "productiva") ? "#2e7d32" : (stD === "en desarrollo" ? "#b71c1c" : "#616161");
    cuerpoHtml += "<tr><td style='border:1px solid #ddd;padding:10px;font-size:0.9rem;'>" + f[0] + "</td><td style='border:1px solid #ddd;padding:10px;background-color:" + cO + ";color:" + tO + ";font-weight:bold;text-align:center;font-size:0.8rem;'>" + f[1].toUpperCase() + "</td><td style='border:1px solid #ddd;padding:10px;font-size:0.9rem;'>" + f[2] + "</td><td style='border:1px solid #ddd;padding:10px;background-color:" + cD + ";color:" + tD + ";font-weight:bold;text-align:center;font-size:0.8rem;'>" + f[3].toUpperCase() + "</td></tr>";
  });
  cuerpoHtml += "</table></div>";
  MailApp.sendEmail({ to: userEmail, subject: "Trazabilidad Data Factory - " + nombreTabla, htmlBody: cuerpoHtml });
  registrarOperacion_('generar_reporte', 'salida', 'ok', inicio, ssNuevo.getName());
  return "¡Reporte generado y enviado exitosamente por correo!";
}

function enviarReporteAfectadas(nombreTabla, datosTabla) {
  var inicio = Date.now();
  var userEmail = Session.getActiveUser().getEmail();
  var ssNuevo = SpreadsheetApp.create("Análisis de Impacto - Afectadas por " + nombreTabla);
  var fileId = ssNuevo.getId();
  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.EDIT);
  } catch (e) { console.error("Error al configurar permisos: " + e.toString()); }

  var hoja = ssNuevo.getSheets()[0];
  hoja.getRange(1, 1, 1, 4).setValues([["Origen (Fuente)", "Estado Origen", "Tabla Afectada (Destino)", "Estado Destino"]])
      .setBackground("#004a8d").setFontColor("white").setFontWeight("bold");
  if (datosTabla.length > 0) hoja.getRange(2, 1, datosTabla.length, 4).setValues(datosTabla);
  hoja.autoResizeColumns(1, 4);
  var sheetUrl = ssNuevo.getUrl();

  var cuerpoHtml = "<div style='font-family: sans-serif; color: #333; max-width: 800px; margin: 0 auto;'>";
  cuerpoHtml += "<h2 style='color: #004a8d; border-bottom: 2px solid #f58220; padding-bottom: 10px;'>Análisis de Impacto: Tablas afectadas por " + nombreTabla + "</h2>";
  cuerpoHtml += "<div style='background-color: #f4f7f9; border-left: 4px solid #f58220; padding: 15px; margin: 20px 0;'>";
  cuerpoHtml += "<p style='margin: 0 0 10px 0; font-weight: bold; color: #004a8d;'>⚠️ Reporte de dependencias hacia adelante (Downstream):</p>";
  cuerpoHtml += "<p style='margin: 0;'>Accede al detalle aquí: <a href='" + sheetUrl + "' style='color: #f58220; font-weight: bold; text-decoration: underline;'>Abrir Google Sheet Corporativo</a></p>";
  cuerpoHtml += "<p style='margin: 5px 0 0 0; font-size: 0.85rem; color: #666;'>* Configurado con acceso libre de edición para todo el dominio BBVA.</p>";
  cuerpoHtml += "</div>";
  cuerpoHtml += "<table style='border-collapse: collapse; width: 100%; border: 1px solid #ddd; margin-top: 20px;'>";
  cuerpoHtml += "<tr style='background-color: #004a8d; color: white;'><th style='padding: 10px; text-align: left;'>Origen (Fuente)</th><th style='padding: 10px; text-align: center; width: 140px;'>Estado Origen</th><th style='padding: 10px; text-align: left;'>Tabla Afectada</th><th style='padding: 10px; text-align: center; width: 140px;'>Estado Destino</th></tr>";
  datosTabla.forEach(function(f) {
    var stO = f[1].toLowerCase(), stD = f[3].toLowerCase();
    var cO = (stO === "productiva") ? "#c8e6c9" : (stO === "en desarrollo" ? "#ffcdd2" : "#e0e0e0");
    var cD = (stD === "productiva") ? "#c8e6c9" : (stD === "en desarrollo" ? "#ffcdd2" : "#e0e0e0");
    var tO = (stO === "productiva") ? "#2e7d32" : (stO === "en desarrollo" ? "#b71c1c" : "#616161");
    var tD = (stD === "productiva") ? "#2e7d32" : (stD === "en desarrollo" ? "#b71c1c" : "#616161");
    cuerpoHtml += "<tr><td style='border:1px solid #ddd;padding:10px;font-size:0.9rem;'>" + f[0] + "</td><td style='border:1px solid #ddd;padding:10px;background-color:" + cO + ";color:" + tO + ";font-weight:bold;text-align:center;font-size:0.8rem;'>" + f[1].toUpperCase() + "</td><td style='border:1px solid #ddd;padding:10px;font-size:0.9rem;'>" + f[2] + "</td><td style='border:1px solid #ddd;padding:10px;background-color:" + cD + ";color:" + tD + ";font-weight:bold;text-align:center;font-size:0.8rem;'>" + f[3].toUpperCase() + "</td></tr>";
  });
  cuerpoHtml += "</table></div>";
  MailApp.sendEmail({ to: userEmail, subject: "Análisis de Impacto DF - Tablas Afectadas por " + nombreTabla, htmlBody: cuerpoHtml });
  registrarOperacion_('generar_reporte', 'salida', 'ok', inicio, ssNuevo.getName());
  return "¡Reporte de Tablas Afectadas generado y enviado exitosamente!";
}

function enviarReporteHuerfanas(datosHuerfanas) {
  var inicio = Date.now();
  var userEmail = Session.getActiveUser().getEmail();
  var ssNuevo = SpreadsheetApp.create("Reporte de Tablas sin Archivo de Relaciones TXT");
  var fileId = ssNuevo.getId();
  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.EDIT);
  } catch(e) { console.error("Error al compartir el reporte global: " + e.toString()); }
  
  var hoja = ssNuevo.getSheets()[0];
  hoja.getRange(1, 1, 1, 4).setValues([["Tabla del Catálogo", "Estado de Gobierno", "Data Scientist (DS)", "Data Engineer (DE)"]])
      .setBackground("#d32f2f").setFontColor("white").setFontWeight("bold");
  if (datosHuerfanas.length > 0) hoja.getRange(2, 1, datosHuerfanas.length, 4).setValues(datosHuerfanas);
  hoja.autoResizeColumns(1, 4);
  var sheetUrl = ssNuevo.getUrl();
  
  var cuerpoHtml = "<div style='font-family: sans-serif; color: #333; max-width: 900px; margin: 0 auto;'><h2 style='color: #b71c1c; border-bottom: 2px solid #f58220; padding-bottom: 10px;'>⚠️ Alerta: Tablas sin Definición de Linaje (.txt faltante)</h2><p>Se han identificado tablas dadas de alta en la Guía de Gobierno que no registran archivos de mapeo de dependencias técnicas en la carpeta de Drive.</p><div style='background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0;'><p style='margin: 0 0 10px 0; font-weight: bold; color: #b71c1c;'>📋 Acceso al detalle exhaustivo:</p><p style='margin: 0;'>Accede al detalle aquí: <a href='" + sheetUrl + "' style='color: #d32f2f; font-weight: bold; text-decoration: underline;'>Abrir Google Sheet Corporativo</a></p><p style='margin: 5px 0 0 0; font-size: 0.85rem; color: #666;'>* Acceso libre de edición habilitado para todo el dominio. Permite coordinar con las duplas DS/DE directamente.</p></div><table style='border-collapse: collapse; width: 100%; border: 1px solid #ddd;'><tr style='background-color: #b71c1c; color: white;'><th>Tabla</th><th style='width: 130px; text-align:center;'>Estado</th><th>Data Scientist</th><th>Data Engineer</th></tr>";
  datosHuerfanas.forEach(function(fila) {
    cuerpoHtml += "<tr><td style='border:1px solid #ddd;padding:8px;font-weight:bold;'>" + fila[0] + "</td><td style='border:1px solid #ddd;padding:8px;text-align:center;background-color:#f5f5f5;text-transform:uppercase;font-size:0.8rem;'>" + fila[1] + "</td><td style='border:1px solid #ddd;padding:8px;color:#004a8d;font-size:0.85rem;'>" + fila[2] + "</td><td style='border:1px solid #ddd;padding:8px;color:#f58220;font-size:0.85rem;'>" + fila[3] + "</td></tr>";
  });
  cuerpoHtml += "</table></div>";
  MailApp.sendEmail({ to: userEmail, subject: "Alerta Gobernanza DF - Tablas sin Archivo TXT", htmlBody: cuerpoHtml });
  registrarOperacion_('generar_reporte', 'salida', 'ok', inicio, ssNuevo.getName());
  return "¡Reporte de tablas huérfanas enviado exitosamente por correo!";
}

// ==========================================
// MÓDULO 2: DASHBOARD MONITOR CALIDAD
// ==========================================

var REGLAS_MVP_TECNICO = {
  '2-1': true, '2-2': true, '2-3': true,
  '3-1': true, '3-2': true, '4-2': true
};

function normalizarModoCalidad_(modo) {
  return String(modo || '').toLowerCase() === 'funcional' ? 'funcional' : 'tecnico';
}

function normalizarIdReglaCalidad_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'd-M');
  }
  var texto = String(valor === null || valor === undefined ? '' : valor).trim();
  var coincidencia = texto.match(/^0*(\d+)\s*[-\/.]\s*0*(\d+)(?:\s*[-\/.]\s*\d{2,4})?$/);
  return coincidencia ? Number(coincidencia[1]) + '-' + Number(coincidencia[2]) : texto;
}

function buscarIndiceIdReglaCalidad_(headers) {
  var nombres = ['principle_rule_type', 'id_regla', 'rule_id', 'numero_regla'];
  for (var i = 0; i < nombres.length; i++) {
    var indice = headers.indexOf(nombres[i]);
    if (indice > -1) return indice;
  }
  return -1;
}

function leerDatosCalidad_(hoja) {
  var rango = hoja.getDataRange();
  var datos = rango.getValues();
  if (datos.length < 2) return datos;
  var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  var indiceIdRegla = buscarIndiceIdReglaCalidad_(headers);
  if (indiceIdRegla === -1) return datos;
  var idsVisibles = hoja.getRange(2, indiceIdRegla + 1, datos.length - 1, 1).getDisplayValues();
  for (var i = 1; i < datos.length; i++) {
    datos[i][indiceIdRegla] = idsVisibles[i - 1][0];
  }
  return datos;
}

function esReglaMvpTecnico_(idRegla) {
  return REGLAS_MVP_TECNICO[normalizarIdReglaCalidad_(idRegla)] === true;
}

function reglaPerteneceModo_(idRegla, modo) {
  var idNormalizado = normalizarIdReglaCalidad_(idRegla);
  if (!idNormalizado) return false;
  return normalizarModoCalidad_(modo) === 'tecnico'
    ? esReglaMvpTecnico_(idNormalizado)
    : !esReglaMvpTecnico_(idNormalizado);
}

function claveDetalleCalidad_(config, nombreTabla, fechaCorte, modo) {
  return ['detalle_calidad_v6', 'v' + config.cacheVersion, config.calidadSheetId,
    nombreTabla, fechaCorte, normalizarModoCalidad_(modo)].join('_');
}

function claveReglasCalidad_(config, nombreTabla, fechaCorte, modo) {
  return ['reglas_calidad_v3', 'v' + config.cacheVersion, config.calidadSheetId,
    nombreTabla, fechaCorte, normalizarModoCalidad_(modo)].join('_');
}

function construirReglaDetalle_(fila, idx, fechaFila, idRegla) {
  var calidad = parseFloat(fila[idx.calidadPct]);
  return {
    id: idRegla,
    nombre: fila[idx.regla] ? fila[idx.regla].toString().trim() : 'Regla Desconocida',
    cutoffDate: fechaFila,
    numerador: fila[idx.numerador],
    denominador: fila[idx.volumen],
    cumplimiento: calidad,
    estado: fila[idx.estado] ? fila[idx.estado].toString().trim() : '',
    campo: idx.campo > -1 && fila[idx.campo] !== '' ? fila[idx.campo].toString().trim() : '-',
    fechaCalidad: idx.hora > -1 ? formatearFechaSQL(fila[idx.hora]) : ''
  };
}

function recortarHistoricoCalidad_(historicoPorFecha, periodicidad) {
  var fechas = Object.keys(historicoPorFecha).sort();
  var esMensual = String(periodicidad || '').toLowerCase() === 'mensual';
  if (esMensual) {
    var meses = {};
    var cortesMensuales = [];
    for (var i = fechas.length - 1; i >= 0 && cortesMensuales.length < 3; i--) {
      var mes = fechas[i].substring(0, 7);
      if (meses[mes]) continue;
      meses[mes] = true;
      cortesMensuales.unshift(fechas[i]);
    }
    fechas = cortesMensuales;
  } else {
    fechas = fechas.slice(-10);
  }
  return fechas.map(function(fecha) {
    var datos = historicoPorFecha[fecha];
    return { fecha: fecha, promedio: parseFloat((datos.suma / datos.conteo).toFixed(2)) };
  });
}

function crearResumenReglasCalidad_() {
  return {
    sumaCalidad: 0, conteoCalidad: 0, totalReglas: 0, reglasOk: 0,
    reglasFallidas: 0, reglasPendientes: 0, incidencias: []
  };
}

function finalizarResumenReglasCalidad_(resumen, modo, sinRegistros) {
  var esTecnico = normalizarModoCalidad_(modo) === 'tecnico';
  var incidencias = resumen.incidencias.slice();
  var fallidas = resumen.reglasFallidas;
  var falloVolumen = esTecnico && sinRegistros && fallidas === 0;
  if (falloVolumen && incidencias.indexOf('Volumen 0') === -1) {
    incidencias.push('Volumen 0');
    fallidas++;
  }
  var status = 'ok';
  if (fallidas > 0) status = esTecnico ? 'err' : 'warn';
  else if (resumen.reglasPendientes > 0) status = 'pending';
  return {
    status: status,
    quality: resumen.conteoCalidad > 0
      ? parseFloat((resumen.sumaCalidad / resumen.conteoCalidad).toFixed(2)) : 100,
    issues: incidencias,
    totalReglas: resumen.totalReglas + (falloVolumen ? 1 : 0),
    reglasOk: resumen.reglasOk,
    reglasFallidas: fallidas,
    reglasPendientes: resumen.reglasPendientes
  };
}

function obtenerDatosMonitor(fechaDesdeStr, fechaHastaStr, frecuenciaCorte) {
  return ejecutarConRegistro_('consultar_monitor', 'calidad', function() {
    var config = obtenerConfiguracion_();
    var ss = abrirSpreadsheetConfigurado_(config.calidadSheetId, 'el Google Sheet de calidad');
    var hoja = obtenerHojaConfigurada_(ss, 'calidad', 'el Google Sheet de calidad');
    var datos = leerDatosCalidad_(hoja);
    return procesarDatosMonitor(datos, fechaDesdeStr, fechaHastaStr, frecuenciaCorte);
  });
}

// En consultas por rango las filas se envían sin el detalle completo de reglas
// para mantener liviana la respuesta. El detalle se recupera al abrir la tabla.
function obtenerDetalleReglasCalidad(nombreTabla, fechaCorte, modoCalidad) {
  var nombreClave = (nombreTabla || '').toString().trim().replace(/\\/g, '').toLowerCase();
  var fechaClave = formatearFechaSQL(fechaCorte);
  if (!nombreClave || !fechaClave) return [];
  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();
  var cacheKey = claveReglasCalidad_(config, nombreClave, fechaClave, modoCalidad);
  try {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (eCache) {}
  return obtenerDetalleTablaCalidad(nombreTabla, fechaCorte, modoCalidad).reglas;
}

// ------------------------------------------------------------------
// Índice de histórico de calidad
// ------------------------------------------------------------------
// El histórico de una tabla (10 cortes diarios o 3 mensuales) obliga a recorrer
// la hoja completa. Para no repetir esa lectura por cada tabla y vista, se
// calcula una sola vez el histórico de TODAS las tablas y se reparte en
// fragmentos de caché pequeños. Cada clic posterior (o cada tabla distinta)
// se resuelve leyendo un único fragmento, sin tocar Sheets.
var HISTORICO_FRAGMENTO_OBJETIVO = 40000;
var HISTORICO_FRAGMENTO_MAXIMO = 90000;

function nombreTablaClave_(valor) {
  return valor ? valor.toString().trim().replace(/\\/g, '').toLowerCase() : '';
}

function hashTablaCalidad_(texto) {
  var h = 0;
  for (var i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return h;
}

function claveIndiceHistorico_(config, parte) {
  return ['hist_idx_v1', 'v' + config.cacheVersion, config.calidadSheetId, parte].join('_');
}

function indicesColumnasCalidad_(headers) {
  var idx = {
    fecha:      headers.indexOf('gf_cutoff_date'),
    tabla:      headers.indexOf('tabla_auditada'),
    estado:     headers.indexOf('estado_error'),
    calidadPct: headers.indexOf('gf_quality_rule_compliance_per'),
    numerador:  headers.indexOf('gf_qr_cplc_numerator_number'),
    volumen:    headers.indexOf('gf_qr_cplc_denominator_number'),
    hora:       headers.indexOf('max_execution_date'),
    regla:      headers.indexOf('nombre_regla'),
    campo:      headers.indexOf('gf_field_physical_name'),
    periodicidad: headers.indexOf('g_qr_execution_frequency_type'),
    idRegla:    buscarIndiceIdReglaCalidad_(headers)
  };
  validarCabeceras_(idx, {
    fecha: 'gf_cutoff_date', tabla: 'tabla_auditada', estado: 'estado_error',
    calidadPct: 'gf_quality_rule_compliance_per', numerador: 'gf_qr_cplc_numerator_number',
    volumen: 'gf_qr_cplc_denominator_number', regla: 'nombre_regla', idRegla: 'principle_rule_type'
  }, 'la hoja calidad');
  return idx;
}

function leerHistoricoIndiceCalidad_(config, cache, nombreClave, modo) {
  try {
    var meta = cache.get(claveIndiceHistorico_(config, 'meta'));
    var fragmentos = parseInt(meta, 10);
    if (!fragmentos) return null;
    var texto = cache.get(claveIndiceHistorico_(config, 'f' + (hashTablaCalidad_(nombreClave) % fragmentos)));
    if (!texto) return null;
    var entrada = JSON.parse(texto)[nombreClave];
    if (!entrada) return { historico: [], periodicidad: '' };
    return { historico: modo === 'funcional' ? entrada.f : entrada.t, periodicidad: entrada.p || '' };
  } catch (e) {
    return null;
  }
}

function guardarIndiceHistoricoCalidad_(config, cache, indice) {
  var tablas = Object.keys(indice);
  var total = JSON.stringify(indice).length;
  var fragmentos = Math.max(1, Math.ceil(total / HISTORICO_FRAGMENTO_OBJETIVO));
  for (var intento = 0; intento < 4; intento++) {
    var partes = [];
    for (var n = 0; n < fragmentos; n++) partes.push({});
    tablas.forEach(function(tabla) { partes[hashTablaCalidad_(tabla) % fragmentos][tabla] = indice[tabla]; });
    var textos = partes.map(function(parte) { return JSON.stringify(parte); });
    var maximo = textos.reduce(function(m, t) { return Math.max(m, t.length); }, 0);
    if (maximo > HISTORICO_FRAGMENTO_MAXIMO) { fragmentos *= 2; continue; }
    var paraCache = {};
    textos.forEach(function(texto, n) { paraCache[claveIndiceHistorico_(config, 'f' + n)] = texto; });
    paraCache[claveIndiceHistorico_(config, 'meta')] = String(fragmentos);
    try { cache.putAll(paraCache, config.cacheCalidadSegundos); }
    catch (e) { console.warn('No se pudo guardar el índice de histórico: ' + e.message); }
    return;
  }
}

// Una única pasada sobre la hoja: calcula el histórico de todas las tablas y,
// si se pide, recoge las reglas de una tabla y fecha concretas.
function construirIndiceHistoricoCalidad_(datos, idx, nombreObjetivo, fechaObjetivo) {
  var acumulado = {};
  var periodicidades = {};
  var reglasObjetivo = { tecnico: [], funcional: [] };
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var tabla = nombreTablaClave_(fila[idx.tabla]);
    if (!tabla) continue;
    var fecha = formatearFechaSQL(fila[idx.fecha]);
    if (!fecha) continue;
    var idRegla = normalizarIdReglaCalidad_(fila[idx.idRegla]);
    if (!idRegla) continue;
    var modo = esReglaMvpTecnico_(idRegla) ? 'tecnico' : 'funcional';
    if (!periodicidades[tabla] && idx.periodicidad > -1 && fila[idx.periodicidad] !== '') {
      periodicidades[tabla] = String(fila[idx.periodicidad]).trim();
    }
    var estado = fila[idx.estado] ? fila[idx.estado].toString().trim() : '';
    var calidad = parseFloat(fila[idx.calidadPct]);

    // Un pendiente aún no tiene una medición de calidad y no debe bajar el histórico.
    if (estado.toUpperCase() !== 'PENDIENTE' && !isNaN(calidad)) {
      var porTabla = acumulado[tabla] || (acumulado[tabla] = { tecnico: {}, funcional: {} });
      var celda = porTabla[modo][fecha] || (porTabla[modo][fecha] = { suma: 0, conteo: 0 });
      celda.suma += calidad;
      celda.conteo++;
    }
    if (nombreObjetivo && tabla === nombreObjetivo && fecha === fechaObjetivo) {
      reglasObjetivo[modo].push(construirReglaDetalle_(fila, idx, fecha, idRegla));
    }
  }
  var indice = {};
  Object.keys(acumulado).forEach(function(tabla) {
    var periodicidad = periodicidades[tabla] || '';
    indice[tabla] = {
      p: periodicidad,
      t: recortarHistoricoCalidad_(acumulado[tabla].tecnico, periodicidad),
      f: recortarHistoricoCalidad_(acumulado[tabla].funcional, periodicidad)
    };
  });
  return { indice: indice, reglas: reglasObjetivo, periodicidades: periodicidades };
}

// Lee la hoja una vez, deja el índice en caché y devuelve lo calculado.
function reconstruirIndiceHistoricoCalidad_(config, cache, nombreObjetivo, fechaObjetivo) {
  var ss = abrirSpreadsheetConfigurado_(config.calidadSheetId, 'el Google Sheet de calidad');
  var hoja = obtenerHojaConfigurada_(ss, 'calidad', 'el Google Sheet de calidad');
  var datos = leerDatosCalidad_(hoja);
  if (datos.length < 2) return { indice: {}, reglas: { tecnico: [], funcional: [] }, periodicidades: {} };
  var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  var resultado = construirIndiceHistoricoCalidad_(datos, indicesColumnasCalidad_(headers), nombreObjetivo, fechaObjetivo);
  guardarIndiceHistoricoCalidad_(config, cache, resultado.indice);
  return resultado;
}

function respuestaHistoricoCalidad_(historico, periodicidad, modo) {
  return {
    historico: historico,
    modo: modo,
    periodicidad: periodicidad,
    limiteHistorico: String(periodicidad).toLowerCase() === 'mensual' ? 3 : 10
  };
}

// Histórico de una tabla para el gráfico del modal. Con el índice en caché no
// lee Sheets; si falta, lo reconstruye para todas las tablas de una vez.
function obtenerHistoricoTablaCalidad(nombreTabla, modoCalidad) {
  var nombreClave = nombreTablaClave_(nombreTabla);
  var modo = normalizarModoCalidad_(modoCalidad);
  if (!nombreClave) return respuestaHistoricoCalidad_([], '', modo);
  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();

  var enCache = leerHistoricoIndiceCalidad_(config, cache, nombreClave, modo);
  if (enCache) return respuestaHistoricoCalidad_(enCache.historico, enCache.periodicidad, modo);

  var resultado = reconstruirIndiceHistoricoCalidad_(config, cache, '', '');
  var entrada = resultado.indice[nombreClave];
  return respuestaHistoricoCalidad_(
    entrada ? (modo === 'funcional' ? entrada.f : entrada.t) : [],
    entrada ? entrada.p : (resultado.periodicidades[nombreClave] || ''), modo);
}

// Calienta el índice en segundo plano justo después de la carga inicial para
// que el primer clic en una tabla ya lo encuentre listo.
function precalentarHistoricoCalidad() {
  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();
  try {
    if (parseInt(cache.get(claveIndiceHistorico_(config, 'meta')), 10)) return { estado: 'listo' };
  } catch (e) {}
  var resultado = reconstruirIndiceHistoricoCalidad_(config, cache, '', '');
  return { estado: 'calculado', tablas: Object.keys(resultado.indice).length };
}

// Devuelve reglas e histórico de una tabla y fecha. Si ambos están en caché no
// se lee Sheets; si falta alguno, una sola lectura completa recompone todo.
function obtenerDetalleTablaCalidad(nombreTabla, fechaCorte, modoCalidad) {
  var nombreClave = nombreTablaClave_(nombreTabla);
  var fechaClave = formatearFechaSQL(fechaCorte);
  var modo = normalizarModoCalidad_(modoCalidad);
  if (!nombreClave || !fechaClave) return { reglas: [], historico: [] };

  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();
  var cacheKey = claveDetalleCalidad_(config, nombreClave, fechaClave, modo);
  try {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (eCache) {}

  var reglas = null;
  try {
    var reglasEnCache = cache.get(claveReglasCalidad_(config, nombreClave, fechaClave, modo));
    if (reglasEnCache) reglas = JSON.parse(reglasEnCache);
  } catch (eReglas) {}
  var historico = leerHistoricoIndiceCalidad_(config, cache, nombreClave, modo);

  if (!reglas || !historico) {
    var resultado = reconstruirIndiceHistoricoCalidad_(config, cache, nombreClave, fechaClave);
    var entrada = resultado.indice[nombreClave];
    if (!reglas) reglas = resultado.reglas[modo];
    if (!historico) {
      historico = {
        historico: entrada ? (modo === 'funcional' ? entrada.f : entrada.t) : [],
        periodicidad: entrada ? entrada.p : (resultado.periodicidades[nombreClave] || '')
      };
    }
  }

  var respuesta = respuestaHistoricoCalidad_(historico.historico, historico.periodicidad, modo);
  respuesta.reglas = reglas;
  try { cache.put(cacheKey, JSON.stringify(respuesta), config.cacheCalidadSegundos); } catch (ePut) {}
  return respuesta;
}

// Procesa los datos ya leídos de la hoja 'calidad' para una fecha (o rango) dada.
// Separado de la lectura para poder reutilizar una única lectura de Sheets
// (ver obtenerCargaInicial).
function procesarDatosMonitor(datos, fechaDesdeStr, fechaHastaStr, frecuenciaCorte) {
  if (datos.length < 2) return [];

  // Normalizar también los argumentos recibidos desde la interfaz. Una consulta
  // de fecha única se filtra como un rango de un solo día para que ambos modos
  // recorran exactamente la misma lógica de comparación.
  var fechaDesdeFiltro = formatearFechaSQL(fechaDesdeStr);
  var fechaHastaFiltro = formatearFechaSQL(fechaHastaStr);
  var esConsultaRango = !!fechaHastaFiltro;
  var rangoFechas = [fechaDesdeFiltro, fechaHastaFiltro || fechaDesdeFiltro];

  var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  
  var idx = {
    fecha:        headers.indexOf('gf_cutoff_date'),
    tabla:        headers.indexOf('tabla_auditada'),
    estado:       headers.indexOf('estado_error'),
    calidadPct:   headers.indexOf('gf_quality_rule_compliance_per'),
    numerador:    headers.indexOf('gf_qr_cplc_numerator_number'), 
    volumen:      headers.indexOf('gf_qr_cplc_denominator_number'),
    hora:         headers.indexOf('max_execution_date'),
    regla:        headers.indexOf('nombre_regla'),
    periodicidad: headers.indexOf('g_qr_execution_frequency_type'),
    ttm:          headers.indexOf('ttmm'),
    campo:        headers.indexOf('gf_field_physical_name'),
    uuaa:         headers.indexOf('uuaa'),
    idRegla:      buscarIndiceIdReglaCalidad_(headers)
  };

  validarCabeceras_(idx, {
    fecha: 'gf_cutoff_date',
    tabla: 'tabla_auditada',
    estado: 'estado_error',
    calidadPct: 'gf_quality_rule_compliance_per',
    numerador: 'gf_qr_cplc_numerator_number',
    volumen: 'gf_qr_cplc_denominator_number',
    hora: 'max_execution_date',
    regla: 'nombre_regla',
    periodicidad: 'g_qr_execution_frequency_type',
    idRegla: 'principle_rule_type'
  }, 'la hoja calidad');

  // Gobierno: intentar desde caché, si no hay releer Sheets
  var govData;
  var configGobierno = obtenerConfiguracion_();
  var cacheKeyGobierno = claveCache_('gobiernoData_v5', [configGobierno.gobiernoSheetId]);
  try {
    var cachedGov = CacheService.getScriptCache().get(cacheKeyGobierno);
    govData = cachedGov ? JSON.parse(cachedGov) : obtenerEstadosYListaTablas();
  } catch(e) {
    govData = obtenerEstadosYListaTablas();
  }

  // CLAVE PRIMARIA: fecha + "||" + tabla
  // Cada combinación única fecha+tabla genera una fila independiente en el dashboard
  var grupos = {};

  // Para cortes mensuales se calcula primero la última fecha disponible de cada
  // mes completo y después se comprueba si ese cierre cae dentro del rango.
  // Así, un rango que termina a mitad de mes no convierte ese día en cierre.
  var esMensual = (frecuenciaCorte || 'diaria').toString().toLowerCase() === 'mensual';
  var ultimasFechasPorMes = {};
  if (esMensual && esConsultaRango) {
    for (var f = 1; f < datos.length; f++) {
      var fechaDisponible = formatearFechaSQL(datos[f][idx.fecha]);
      if (!fechaDisponible) continue;
      var mesDisponible = fechaDisponible.substring(0, 7);
      if (!ultimasFechasPorMes[mesDisponible] || fechaDisponible > ultimasFechasPorMes[mesDisponible]) {
        ultimasFechasPorMes[mesDisponible] = fechaDisponible;
      }
    }
  }

  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var fechaCasteada = formatearFechaSQL(fila[idx.fecha]);

    // Filtro de fecha
    var coincideFecha = fechaCasteada >= rangoFechas[0] && fechaCasteada <= rangoFechas[1];
    if (coincideFecha && esMensual && esConsultaRango) {
      coincideFecha = ultimasFechasPorMes[fechaCasteada.substring(0, 7)] === fechaCasteada;
    }
    if (!coincideFecha) continue;

    var nombreTabla = fila[idx.tabla] ? fila[idx.tabla].toString().trim() : "SIN_NOMBRE";
    var claveGob    = nombreTabla.toLowerCase().replace(/\\/g, '');
    var idReglaFila = idx.idRegla > -1 ? normalizarIdReglaCalidad_(fila[idx.idRegla]) : '';
    if (!idReglaFila) continue;
    var modoRegla = esReglaMvpTecnico_(idReglaFila) ? 'tecnico' : 'funcional';

    // Clave compuesta: fecha + separador + tabla
    var clavePrincipal = fechaCasteada + '||' + nombreTabla;

    if (!grupos[clavePrincipal]) {
      var dsMonitor = govData.mapeoDS[claveGob];
      var deMonitor = govData.mapeoDE[claveGob];
      var funcionalMonitor = govData.mapeoFuncional[claveGob];
      if (!dsMonitor || dsMonitor.trim() === '') dsMonitor = 'BAU';
      if (!deMonitor || deMonitor.trim() === '') deMonitor = 'BAU';
      if (!funcionalMonitor || funcionalMonitor.trim() === '') funcionalMonitor = 'BAU';

      grupos[clavePrincipal] = {
        id:            clavePrincipal,
        name:          nombreTabla,
        cutoffDate:    fechaCasteada,
        schema:        'CALIDAD',
        layer:         'Auditoría',
        uuaa:          idx.uuaa > -1 ? fila[idx.uuaa].toString().trim() : "-",
        periodicidad:  idx.periodicidad > -1 ? fila[idx.periodicidad].toString().trim() : "-",
        ttm:           idx.ttm > -1 && fila[idx.ttm] !== '' ? fila[idx.ttm].toString().trim() : (govData.mapeoTTM[claveGob] || '1'),
        estadoGob:     govData.mapeoEstados[claveGob] || "desconocido",
        funcional:     funcionalMonitor,
        dataScientist: dsMonitor,
        dataEngineer:  deMonitor,
        vistas: {
          tecnico: crearResumenReglasCalidad_(),
          funcional: crearResumenReglasCalidad_()
        },
        reglasDetalle: { tecnico: [], funcional: [] },
        maxVolumen:    0,
        volumenInformado: false,
        maxEjecucion:  '',
        volumenNoPendienteInformado: false
      };
    }

    var g = grupos[clavePrincipal];
    var resumenModo = g.vistas[modoRegla];

    var estadoError = fila[idx.estado] ? fila[idx.estado].toString().trim() : "";
    var estadoNormalizado = estadoError.toUpperCase();
    var esPendiente = estadoNormalizado === 'PENDIENTE';

    var valCalidad = parseFloat(fila[idx.calidadPct]);
    if (!isNaN(valCalidad) && !esPendiente) {
      resumenModo.sumaCalidad += valCalidad;
      resumenModo.conteoCalidad++;
    }
    resumenModo.totalReglas++;

    var valVolumen = parseInt(fila[idx.volumen], 10);
    if (!isNaN(valVolumen)) {
      g.volumenInformado = true;
      if (valVolumen > g.maxVolumen) g.maxVolumen = valVolumen;
      if (!esPendiente) g.volumenNoPendienteInformado = true;
    }

    var horaCelda = fila[idx.hora];
    if (horaCelda && g.maxEjecucion === '') g.maxEjecucion = formatearHoraExacta(horaCelda);

    var nombreRegla = fila[idx.regla]  ? fila[idx.regla].toString().trim()  : "Regla Desconocida";
    g.reglasDetalle[modoRegla].push(construirReglaDetalle_(fila, idx, fechaCasteada, idReglaFila));

    if (estadoNormalizado === 'EXITOSA') {
      resumenModo.reglasOk++;
    } else if (estadoNormalizado === 'PENDIENTE') {
      resumenModo.reglasPendientes++;
      if (resumenModo.incidencias.indexOf(nombreRegla) === -1) resumenModo.incidencias.push(nombreRegla);
    } else if (estadoError !== '') {
      resumenModo.reglasFallidas++;
      if (resumenModo.incidencias.indexOf(nombreRegla) === -1) resumenModo.incidencias.push(nombreRegla);
    }

  }

  var resultadoFinal = [];
  var reglasParaCache = {};
  for (var clave in grupos) {
    var obj = grupos[clave];
    var sinRegistros = obj.volumenNoPendienteInformado && obj.maxVolumen === 0;
    var vistaTecnica = finalizarResumenReglasCalidad_(obj.vistas.tecnico, 'tecnico', sinRegistros);
    var vistaFuncional = finalizarResumenReglasCalidad_(obj.vistas.funcional, 'funcional', false);
    var nombreCache = obj.name.toString().trim().replace(/\\/g, '').toLowerCase();
    ['tecnico', 'funcional'].forEach(function(modoCache) {
      reglasParaCache[claveReglasCalidad_(configGobierno, nombreCache, obj.cutoffDate, modoCache)] =
        JSON.stringify(obj.reglasDetalle[modoCache]);
    });

    resultadoFinal.push({
      id:            obj.id,
      name:          obj.name,
      cutoffDate:    obj.cutoffDate,
      schema:        obj.schema,
      layer:         obj.layer,
      uuaa:          obj.uuaa,
      estadoGob:     obj.estadoGob,
      funcional:     obj.funcional,
      dataScientist: obj.dataScientist,
      dataEngineer:  obj.dataEngineer,
      status:        vistaTecnica.status,
      quality:       vistaTecnica.quality,
      rows:          obj.maxVolumen,
      startTime:     obj.maxEjecucion !== '' ? obj.maxEjecucion : '-',
      periodicidad:  obj.periodicidad,
      ttm:           obj.ttm,
      issues:        vistaTecnica.issues,
      vistas: {
        tecnico: vistaTecnica,
        funcional: vistaFuncional
      },
      // La respuesta principal siempre se mantiene liviana. El detalle se
      // recupera bajo demanda al abrir la tabla, tanto en fecha única como en
      // rango, evitando límites de transferencia en cortes con muchas reglas.
      reglas:        [],
      detallePendiente: true
    });
  }

  // Ordenar por fecha DESC, luego por tabla ASC
  resultadoFinal.sort(function(a, b) {
    if (a.cutoffDate !== b.cutoffDate) return b.cutoffDate.localeCompare(a.cutoffDate);
    return a.name.localeCompare(b.name);
  });

  try {
    CacheService.getScriptCache().putAll(reglasParaCache, configGobierno.cacheCalidadSegundos);
  } catch (eReglasCache) {
    console.warn('No se pudo precargar el detalle de reglas: ' + eReglasCache.message);
  }

  // Devolver como objeto para que procesos y dir lleguen al cliente
  // (las propiedades extra en arrays no se serializan por google.script.run)
  return {
    filas:    resultadoFinal,
    procesos: govData.mapeoProcesos || {},
    dir:      govData.mapeoDir      || {},
    funcional: govData.mapeoFuncional || {},
    ds:       govData.mapeoDS       || {},
    de:       govData.mapeoDE       || {}
  };
}

// ==========================================
// MÓDULO 2B: HISTÓRICO DE CALIDAD (10 diarios o 3 mensuales)
// ==========================================

function obtenerHistoricoCalidad(nombreTabla) {
  var nombreLower = nombreTabla.toLowerCase().trim();
  var config = obtenerConfiguracion_();
  var cacheKey = claveCache_('hist', [config.calidadSheetId, nombreLower]);
  var cache = CacheService.getScriptCache();

  // 1) Reaperturas instantáneas: servir desde caché si existe
  try {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (e) {}

  // 2) Lectura ÚNICA de la hoja: calcular el histórico de TODAS las tablas
  //    en una sola pasada y cachearlas juntas. El primer clic paga la lectura
  //    una vez; los siguientes clics (cualquier tabla) salen de caché.
  var ss = abrirSpreadsheetConfigurado_(config.calidadSheetId, 'el Google Sheet de calidad');
  var hoja = obtenerHojaConfigurada_(ss, 'calidad', 'el Google Sheet de calidad');
  var datos = hoja.getDataRange().getValues();

  if (datos.length < 2) return [];

  var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  var idx = {
    fecha:      headers.indexOf('gf_cutoff_date'),
    tabla:      headers.indexOf('tabla_auditada'),
    calidadPct: headers.indexOf('gf_quality_rule_compliance_per'),
    periodicidad: headers.indexOf('g_qr_execution_frequency_type')
  };
  validarCabeceras_(idx, {
    fecha: 'gf_cutoff_date',
    tabla: 'tabla_auditada',
    calidadPct: 'gf_quality_rule_compliance_per'
  }, 'la hoja calidad');

  // agrupado[tablaLower][fecha] = { suma, conteo }
  var agrupado = {};
  var periodicidadPorTabla = {};
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var tablaNombre = fila[idx.tabla] ? fila[idx.tabla].toString().trim().toLowerCase() : '';
    if (!tablaNombre) continue;

    var fechaStr = formatearFechaSQL(fila[idx.fecha]);
    if (!fechaStr) continue;

    var val = parseFloat(fila[idx.calidadPct]);
    if (isNaN(val)) continue;
    if (!periodicidadPorTabla[tablaNombre] && idx.periodicidad > -1 && fila[idx.periodicidad] !== '') {
      periodicidadPorTabla[tablaNombre] = String(fila[idx.periodicidad]).trim();
    }

    if (!agrupado[tablaNombre]) agrupado[tablaNombre] = {};
    if (!agrupado[tablaNombre][fechaStr]) agrupado[tablaNombre][fechaStr] = { suma: 0, conteo: 0 };
    agrupado[tablaNombre][fechaStr].suma += val;
    agrupado[tablaNombre][fechaStr].conteo++;
  }

  // Construir la serie corta según periodicidad y cachear todas las tablas.
  var paraCache = {};
  var resultadoPedido = [];
  for (var tab in agrupado) {
    var fechasMap = agrupado[tab];
    var serie = recortarHistoricoCalidad_(fechasMap, periodicidadPorTabla[tab]);
    paraCache[claveCache_('hist', [config.calidadSheetId, tab])] = JSON.stringify(serie);
    if (tab === nombreLower) resultadoPedido = serie;
  }

  // Cachear 10 min. Si el volcado masivo falla (p.ej. demasiadas claves),
  // al menos se cachea la tabla pedida para acelerar sus reaperturas.
  try {
    cache.putAll(paraCache, config.cacheCalidadSegundos);
  } catch (e) {
    try { cache.put(cacheKey, JSON.stringify(resultadoPedido), config.cacheCalidadSegundos); } catch (e2) {}
  }

  return resultadoPedido;
}

// ==========================================
// MÓDULO 2C: MONITOREO DE ESTABILIDAD (45 días corridos)
// ==========================================

function obtenerMonitoreoEstabilidad(fechaReferencia, nombreTablaDetalle) {
  var config = obtenerConfiguracion_();
  var cache = CacheService.getScriptCache();
  var fechaHastaSolicitada = formatearFechaSQL(fechaReferencia);
  var nombreObjetivo = (nombreTablaDetalle || '').toString().trim().replace(/\\/g, '').toLowerCase();
  var cacheKey = fechaHastaSolicitada
    ? claveCache_('estabilidad_45_v7', [config.calidadSheetId, fechaHastaSolicitada]) : '';

  // El resumen puede salir de caché sin volver a leer la hoja. Los detalles de
  // tabla se calculan bajo demanda y no comparten esta respuesta resumida.
  if (cacheKey && !nombreObjetivo) {
    try {
      var hit = cache.get(cacheKey);
      if (hit) return JSON.parse(hit);
    } catch (eCache) {}
  }

  var ss = abrirSpreadsheetConfigurado_(config.calidadSheetId, 'el Google Sheet de calidad');
  var hoja = obtenerHojaConfigurada_(ss, 'calidad', 'el Google Sheet de calidad');
  var datos = leerDatosCalidad_(hoja);
  if (datos.length < 2) return { desde: '', hasta: '', tablas: [] };

  var headers = datos[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  var idx = {
    fecha:      headers.indexOf('gf_cutoff_date'),
    tabla:      headers.indexOf('tabla_auditada'),
    calidadPct: headers.indexOf('gf_quality_rule_compliance_per'),
    estado:     headers.indexOf('estado_error'),
    regla:      headers.indexOf('nombre_regla'),
    volumen:    headers.indexOf('gf_qr_cplc_denominator_number'),
    idRegla:    buscarIndiceIdReglaCalidad_(headers)
  };
  validarCabeceras_(idx, {
    fecha: 'gf_cutoff_date',
    tabla: 'tabla_auditada',
    calidadPct: 'gf_quality_rule_compliance_per',
    estado: 'estado_error',
    regla: 'nombre_regla',
    volumen: 'gf_qr_cplc_denominator_number'
  }, 'la hoja calidad');

  // Compatibilidad: si no se recibe fecha desde la interfaz, usar el último
  // corte disponible. Normalmente la referencia será la fecha única elegida o
  // la fecha final del rango seleccionado por el usuario.
  if (!fechaHastaSolicitada) {
    for (var i = 1; i < datos.length; i++) {
      var fechaFila = formatearFechaSQL(datos[i][idx.fecha]);
      if (fechaFila && fechaFila > fechaHastaSolicitada) fechaHastaSolicitada = fechaFila;
    }
  }
  if (!fechaHastaSolicitada) return { desde: '', hasta: '', tablas: [] };

  cacheKey = claveCache_('estabilidad_45_v7', [config.calidadSheetId, fechaHastaSolicitada]);

  var partesFecha = fechaHastaSolicitada.split('-');
  var fechaDesdeObj = new Date(Number(partesFecha[0]), Number(partesFecha[1]) - 1, Number(partesFecha[2]));
  fechaDesdeObj.setDate(fechaDesdeObj.getDate() - 44);
  var fechaDesde = formatearFechaSQL(fechaDesdeObj);
  var govData = obtenerEstadosYListaTablas();
  var grupos = {};

  for (var f = 1; f < datos.length; f++) {
    var fila = datos[f];
    var fecha = formatearFechaSQL(fila[idx.fecha]);
    if (!fecha || fecha < fechaDesde || fecha > fechaHastaSolicitada) continue;

    var nombreTabla = fila[idx.tabla] ? fila[idx.tabla].toString().trim().replace(/\\/g, '') : '';
    if (!nombreTabla) continue;
    var claveTabla = nombreTabla.toLowerCase();
    if (nombreObjetivo && claveTabla !== nombreObjetivo) continue;

    if (!grupos[claveTabla]) {
      var procesosTabla = govData.mapeoProcesos[claveTabla] || {};
      var procesosActivos = [];
      for (var proceso in procesosTabla) {
        if (procesosTabla[proceso] === true) procesosActivos.push(proceso);
      }
      grupos[claveTabla] = {
        nombre: nombreTabla,
        dataEngineer: govData.mapeoDE[claveTabla] || 'BAU',
        direccion: govData.mapeoDir[claveTabla] || 'Local',
        procesos: procesosActivos,
        fechas: {},
        reglas: {},
        errores: 0,
        advertencias: 0,
        pendientes: 0,
        fechasVolumenCero: {}
      };
    }

    var grupo = grupos[claveTabla];
    var estado = fila[idx.estado] ? fila[idx.estado].toString().trim().toUpperCase() : '';
    var esPendiente = estado === 'PENDIENTE';
    var calidad = parseFloat(fila[idx.calidadPct]);
    if (!isNaN(calidad) && !esPendiente) {
      if (!grupo.fechas[fecha]) grupo.fechas[fecha] = { suma: 0, conteo: 0 };
      grupo.fechas[fecha].suma += calidad;
      grupo.fechas[fecha].conteo++;
    }

    var nombreRegla = fila[idx.regla] ? fila[idx.regla].toString().trim() : 'Regla Desconocida';
    var idRegla = idx.idRegla > -1 ? normalizarIdReglaCalidad_(fila[idx.idRegla]) : '';
    if (!idRegla) continue;
    var claveRegla = idRegla + '||' + nombreRegla;
    if (!grupo.reglas[claveRegla]) {
      grupo.reglas[claveRegla] = { id: idRegla, nombre: nombreRegla, suma: 0, conteo: 0, fallos: 0, pendientes: 0 };
    }
    if (!isNaN(calidad) && !esPendiente) {
      grupo.reglas[claveRegla].suma += calidad;
      grupo.reglas[claveRegla].conteo++;
    }

    if (estado && estado !== 'EXITOSA') {
      if (estado === 'PENDIENTE') {
        grupo.reglas[claveRegla].pendientes++;
        grupo.pendientes++;
      }
      else if (estado === 'ADVERTENCIA') {
        grupo.reglas[claveRegla].fallos++;
        grupo.advertencias++;
      }
      else {
        grupo.reglas[claveRegla].fallos++;
        grupo.errores++;
      }
    }

    var volumen = parseInt(fila[idx.volumen], 10);
    if (!esPendiente && !isNaN(volumen) && volumen === 0) grupo.fechasVolumenCero[fecha] = true;
  }

  var resultadoTablas = [];
  for (var clave in grupos) {
    var g = grupos[clave];
    var serieDiaria = [];
    var sumaPromediosDiarios = 0;
    Object.keys(g.fechas).sort().forEach(function(fecha) {
      var dia = g.fechas[fecha];
      var promedioDia = parseFloat((dia.suma / dia.conteo).toFixed(2));
      serieDiaria.push({ fecha: fecha, promedio: promedioDia });
      sumaPromediosDiarios += promedioDia;
    });
    var promedioTabla = serieDiaria.length > 0
      ? parseFloat((sumaPromediosDiarios / serieDiaria.length).toFixed(2)) : 0;

    var reglas = [];
    for (var claveR in g.reglas) {
      var regla = g.reglas[claveR];
      reglas.push({
        id: regla.id,
        nombre: regla.nombre,
        promedio: regla.conteo > 0 ? parseFloat((regla.suma / regla.conteo).toFixed(2)) : 0,
        ejecuciones: regla.conteo,
        fallos: regla.fallos,
        pendientes: regla.pendientes
      });
    }
    reglas.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });

    var diasVolumenCero = Object.keys(g.fechasVolumenCero).length;
    resultadoTablas.push({
      nombre: g.nombre,
      dataEngineer: g.dataEngineer,
      direccion: g.direccion,
      procesos: g.procesos,
      promedio: promedioTabla,
      diasConDatos: serieDiaria.length,
      errores: g.errores,
      advertencias: g.advertencias,
      pendientes: g.pendientes,
      diasVolumenCero: diasVolumenCero,
      status: (g.errores > 0 || diasVolumenCero > 0) ? 'err' : (g.advertencias > 0 ? 'warn' : (g.pendientes > 0 ? 'pending' : 'ok')),
      serieDiaria: nombreObjetivo ? serieDiaria : [],
      reglas: nombreObjetivo ? reglas : [],
      detalleIncluido: !!nombreObjetivo
    });
  }
  resultadoTablas.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });

  var resultado = { desde: fechaDesde, hasta: fechaHastaSolicitada, tablas: resultadoTablas };
  if (!nombreObjetivo) {
    try { cache.put(cacheKey, JSON.stringify(resultado), config.cacheCalidadSegundos); } catch (ePut) {}
  }
  return resultado;
}

// Helpers
function formatearFechaSQL(fechaInput) {
  if (!fechaInput) return "";
  if (fechaInput instanceof Date) {
    if (isNaN(fechaInput.getTime())) return "";
    var y  = fechaInput.getFullYear();
    var m  = ('0' + (fechaInput.getMonth() + 1)).slice(-2);
    var d  = ('0' + fechaInput.getDate()).slice(-2);
    return y + '-' + m + '-' + d; 
  }

  var texto = fechaInput.toString().trim();
  if (!texto) return "";

  // Formatos ISO habituales: yyyy-MM-dd, yyyy/MM/dd y variantes con hora.
  var iso = texto.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) {
    return iso[1] + '-' + ('0' + iso[2]).slice(-2) + '-' + ('0' + iso[3]).slice(-2);
  }

  // Algunas cargas de Sheets llegan como texto con formato regional dd-MM-yyyy.
  var regional = texto.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (regional) {
    return regional[3] + '-' + ('0' + regional[2]).slice(-2) + '-' + ('0' + regional[1]).slice(-2);
  }

  // Mantener compatibilidad con cualquier texto no reconocido previamente.
  return texto.split('T')[0];
}

function formatearHoraExacta(fechaInput) {
  if (!fechaInput) return "-";
  if (fechaInput instanceof Date) {
    var y  = fechaInput.getFullYear();
    var mo = ('0' + (fechaInput.getMonth() + 1)).slice(-2);
    var d  = ('0' + fechaInput.getDate()).slice(-2);
    var h  = ('0' + fechaInput.getHours()).slice(-2);
    var m  = ('0' + fechaInput.getMinutes()).slice(-2);
    var s  = ('0' + fechaInput.getSeconds()).slice(-2);
    return y + '-' + mo + '-' + d + ' ' + h + ':' + m + ':' + s;
  }
  return fechaInput.toString().trim(); 
}
