# Data Factory - Monitor de Calidad y Trazabilidad

Aplicación web de Google Apps Script que combina un monitor de calidad de datos
con el catálogo de gobierno y las relaciones de trazabilidad técnica.

## Recursos externos

La aplicación necesita estos recursos:

| Propiedad de Apps Script | Recurso esperado |
| --- | --- |
| `TRAZABILIDAD_FOLDER_ID` | Carpeta de Drive con archivos `.txt` que contienen relaciones `origen --> destino` |
| `GOBIERNO_SHEET_ID` | Google Sheet con las hojas `Guía de tablas` y, opcionalmente, `DataX Holding to Local` |
| `CALIDAD_SHEET_ID` | Google Sheet con la hoja `calidad` |
| `CACHE_TRAZABILIDAD_SEGUNDOS` | Tiempo de reutilización de la lectura de trazabilidad (60–21600; por defecto 300) |
| `CACHE_GOBIERNO_SEGUNDOS` | Tiempo de reutilización del catálogo de gobierno (60–21600; por defecto 600) |
| `CACHE_CALIDAD_SEGUNDOS` | Tiempo de reutilización de datos de calidad (60–21600; por defecto 600) |
| `ADMIN_EMAILS` | Correos autorizados para Administración, separados por comas |
| `CACHE_VERSION` | Versión interna que invalida todas las claves de caché |

Los IDs históricos permanecen como respaldo en `CONFIG_DEFAULTS` para que el
despliegue actual siga funcionando. Las propiedades de Apps Script siempre
tienen prioridad y permiten configurar otros ambientes sin modificar código.

## Configuración de un ambiente

1. Abrir el proyecto en Google Apps Script.
2. Ir a **Configuración del proyecto**.
3. En **Propiedades de la secuencia de comandos**, crear las propiedades de
   recursos y, si corresponde, los TTL y administradores indicados arriba.
4. Asignar los IDs de Drive. Desde la pantalla Administración también se puede
   pegar un ID o una URL completa; la aplicación extrae el ID y prueba el
   acceso antes de guardar.
5. Confirmar que la cuenta que ejecuta la aplicación tiene acceso a la carpeta
   y a los dos Google Sheets.

Para desarrollo se recomienda usar recursos separados y guardar sus IDs en las
propiedades del proyecto de desarrollo. El proyecto productivo debe mantener sus
propias propiedades.

## Administración y operación

La navegación **Administración** reúne en una sola vista:

- Configuración de las tres fuentes y de sus tiempos de caché.
- Prueba real de permisos, carpeta, archivos TXT y hojas requeridas.
- Inventario de TXT con nombre, fecha de modificación y tamaño.
- Flujo visible de entradas, transformaciones y salidas de la aplicación.
- Usuarios recientes, con presencia activa durante los últimos 15 minutos.
- Las 15 operaciones más recientes, con usuario, duración, estado y detalle.
- Invalidación lógica de caché para forzar la siguiente lectura de los orígenes.

Los TTL no programan lecturas en segundo plano: indican cuánto tiempo puede
reutilizarse una lectura antes de volver a consultar Drive o Sheets.

El servidor comprueba el correo obtenido de la sesión en cada operación
administrativa. Si `ADMIN_EMAILS` todavía no existe, el primer usuario
identificado que abre Administración queda registrado como administrador. Para
altas o bajas posteriores se edita `ADMIN_EMAILS`; la autorización nunca se
toma de un dato enviado por el navegador.

La actividad se conserva de forma acotada en Script Properties y también se
emite como JSON al registro de ejecución de Apps Script. Las lecturas usan
claves de caché aisladas por recurso y versión para evitar cruces entre hojas,
tablas o fechas.

## Contrato mínimo de datos

La hoja `calidad` debe incluir estas cabeceras:

- `gf_cutoff_date`
- `tabla_auditada`
- `estado_error`
- `gf_quality_rule_compliance_per`
- `gf_qr_cplc_numerator_number`
- `gf_qr_cplc_denominator_number`
- `max_execution_date`
- `nombre_regla`
- `g_qr_execution_frequency_type`
- `principle_rule_type`

La aplicación también reconoce la cabecera `uuaa`. Si el origen entrega
`gf_uuaa_id`, debe homologarse el nombre o ampliarse el lector antes de publicar
ese cambio.

## Vistas de Calidad

El monitor separa la evaluación en dos pantallas que comparten fecha, proceso,
trazabilidad, gobierno, responsable, dirección, búsqueda y periodicidad:

- **MVP Técnico**: reglas críticas `2-1`, `2-2`, `2-3`, `3-1`, `3-2` y `4-2`.
   Sus fallos se muestran en rojo y determinan los KPIs técnicos.
- **Fallos Funcionales**: las demás reglas, incluidas `4-3` y `3-5`. Sus
   incidencias se muestran como advertencias amarillas y sus KPIs se calculan
   únicamente con reglas no críticas. Las tablas sin reglas funcionales no se
   muestran en esta vista.

Los dos submódulos se seleccionan desde la navegación superior de Calidad. La
aplicación siempre inicia en **MVP Técnico**.

El filtro **Periodicidad** permite mostrar todas las tablas, solo diarias o solo
mensuales. Al abrir una tabla, el detalle y el histórico se conservan por vista
para no mezclar reglas técnicas y funcionales. El gráfico muestra los últimos
10 cortes disponibles para tablas diarias y los últimos 3 cortes de fin de mes
para tablas mensuales.

Durante la carga del monitor se cachean únicamente las reglas del corte visible.
Al abrir una tabla, el modal pide a la vez las reglas y el histórico. El histórico
de **todas** las tablas se calcula en una sola lectura de la hoja y se guarda en
la caché en fragmentos pequeños (`obtenerHistoricoTablaCalidad`); la carga inicial
lo precalienta en segundo plano (`precalentarHistoricoCalidad`). Así, la primera
apertura de cualquier tabla deja de leer la hoja completa. Si la caché no está
disponible, el servidor reconstruye el índice en una única lectura.

## Informes de Calidad

El submódulo **Informes** (Calidad → Informes) analiza el histórico de la hoja
`calidad`. Hoy incluye el informe **Fallos recurrentes**:

- **KPIs principales**: tablas evaluadas, estables, con fallos recurrentes,
  crónicas, reaperturas, tiempo medio de resolución y concentración. Los KPIs
  de grupo son botones: al pulsarlos filtran el resto de la pantalla.
- **Ranking de reincidencia**: días con fallo en 30 y 90 días, racha actual,
  MTTR y reaperturas, siempre con **responsable técnico (Data Engineer)**,
  **Data Scientist** y dirección de cada tabla.
- **Pareto** de incidencias por tabla y **mapa de calor** tabla × corte.
- **Fallos por dimensión y regla**, y **fallos por responsable** (agrupable por
  Data Engineer, Data Scientist, dirección o responsable funcional).
- Filtros dinámicos: ventana (30/90 días), alcance (MVP Técnico, Funcional o
  ambos), periodicidad, responsables, dirección, umbral de recurrencia y búsqueda.

Definiciones (todas sobre los cortes disponibles en la hoja):

| Métrica | Cálculo |
| --- | --- |
| Día con fallo | Corte en el que al menos una regla del alcance no está `Exitosa` ni `Pendiente` |
| Racha actual | Cortes consecutivos fallando hasta el último; un pendiente no la corta |
| Recurrente | Tabla con al menos N días con fallo en la ventana (N configurable) |
| Crónica | Racha actual de 5 cortes o más |
| Estable | Con ejecuciones en la ventana y sin ningún fallo |
| MTTR | Días entre el primer fallo y el primer corte correcto posterior (incidencias cerradas) |
| Reapertura | Nuevo fallo en ≤ 7 días desde que se resolvió una incidencia |
| Concentración | % de incidencias que generan el 30% de las tablas con más fallos |

La dimensión y el nombre de cada regla salen de `CATALOGO_REGLAS` en `Codigo.gs`,
que replica el catálogo oficial: **Disponibilidad** (1-1, 1-2), **Completitud**
(2-1 a 2-4), **Validez** (3-1 a 3-5) y **Consistencia** (4-1, 4-2, 4-3).

**Puntualidad**: los fallos de reglas que no llegaron a ejecutarse dentro del ANS
(`g_quality_rule_status_type = NO ENCONTRADO`, si la columna existe) se cuentan como
Puntualidad. El ANS es el plazo en días hábiles (`ttmm` de la hoja o columna de
gobierno); si una tabla no lo informa se asume **1**. El informe usa la caché de
calidad y se puede refrescar con **Actualizar datos**.

**Pendiente:** el informe de *Acierto de Elipses* necesita primero etiquetar cada
alerta como Real / Falso positivo / Pendiente; sin esa columna no se puede
calcular la precisión.

## Despliegue

1. Verificar la configuración de propiedades y los permisos de los recursos.
2. Ejecutar una función desde el editor para autorizar los servicios de Sheets,
   Drive y correo cuando Google lo solicite.
3. Implementar como aplicación web conservando la política de ejecución y acceso
   aprobada para el entorno corporativo.
4. Probar la carga inicial, una consulta por fecha, una trazabilidad y un envío
   de reporte antes de promover la nueva versión.

## Validación local

La comprobación estructural no requiere dependencias externas:

```bash
python tools/validate_project.py
```

Valida el manifiesto, los IDs de Administración, la correspondencia entre las
llamadas remotas y las funciones servidor, las claves de configuración y que
todo acceso a `google.script.run` pase por el adaptador común.

Después de desplegar, verificar manualmente:

1. Abrir **Administración** con una cuenta autorizada.
2. Pulsar **Probar conexiones** y confirmar los tres estados en verde.
3. Guardar una configuración válida y comprobar que aumenta la versión de caché.
4. Pulsar **Invalidar caché** y cargar Calidad y Trazabilidad de nuevo.
5. Confirmar que el usuario y las operaciones aparecen en las tablas inferiores.
6. Confirmar que Calidad inicia en **MVP Técnico**, alternar a **Funcional**
   desde la navegación superior y comprobar que no aparecen tablas sin reglas
   funcionales.
7. Filtrar por periodicidad y abrir una tabla diaria y otra mensual; sus gráficos
   deben mostrar como máximo 10 y 3 cortes, respectivamente.

## Evidencias de las mejoras

| Mejora | Para qué sirve | Dónde verla |
| --- | --- | --- |
| Configuración externa | Cambiar recursos y TTL sin editar código | Administración → Configuración |
| Diagnóstico de conexiones | Detectar IDs, permisos u hojas incorrectas antes de operar | Administración → Estado de conexiones |
| Caché versionada | Acelerar lecturas y forzar una recarga completa cuando sea necesario | Indicador `Caché vN` e **Invalidar caché** |
| API cliente común | Unificar éxito, error y restauración de controles en llamadas GAS | Avisos de la interfaz y `callServer` en `index.html` |
| Presencia e historial | Saber quién usó la aplicación y qué procesos se ejecutaron | Administración → Usuarios recientes / Historial operativo |
| Flujo operativo | Hacer explícitos orígenes, transformación y productos generados | Administración → Flujo de datos |
| Validación automática | Detectar contratos rotos antes del despliegue | `python tools/validate_project.py` |

El archivo `appsscript.json` versiona la zona horaria, el runtime V8 y el registro
de excepciones. La audiencia y la identidad de ejecución se mantienen como
opciones del despliegue para evitar modificarlas accidentalmente desde el código.
