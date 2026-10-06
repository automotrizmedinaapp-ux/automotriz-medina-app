# Automotriz Medina V4.18.1

Frontend estático preparado para GitHub Pages.

- No contiene el código privado de Google Apps Script.
- No contiene BAT, PowerShell, diagnósticos ni archivos históricos de pruebas.
- El backend se administra por separado y debe responder con `backendBuild: v4-stage4.18-integrity-2026-10-06`.
- Las sesiones recordadas permanecen activas en el navegador.
- Alertzy permanece habilitado y el aviso de vehículo finalizado se envía directamente desde el navegador.
- Incluye botón ↻ Recargar en ADMIN y empleado para forzar la actualización de la PWA.
- El módulo de firma usa el mismo contrato de servicio vigente que el expediente.

Antes de publicar, la validación automática del repositorio debe finalizar correctamente.
- Publicar finalización actualiza la estimación/fecha/hora de entrega y publica al cliente en el mismo paso.
- El menú móvil de ADMIN incluye Vehículos finalizados.
- Tiempo límite del empleado y hora de entrega usan controles explícitos de 12 horas (AM/PM).


- Inventario nuevo: Extintor, Cono / triángulo y Objetos personales.
- Medidor de combustible interno del taller; no se publica al cliente.
- Seguimiento archivado/vencido muestra un mensaje claro de identificador no disponible.
- WhatsApp de autorización usa el mensaje corto aprobado.
- La creación de perfiles vuelve al guardado estable de un solo intento; si falla, el usuario recibe un botón Reintentar y el sistema limpia solo referencias temporales de medios de esa recepción.


## V4.16
- Eliminación definitiva limpia residuos locales del expediente: JSON local, auxiliares, facturas/fotos cacheadas, referencias de media, Cache Storage, tokens locales y confirmaciones asociadas en el navegador administrador.
- La cola de purga se consume una sola vez; un expediente ya purgado no vuelve a intentar eliminarse en cada guardado futuro.
- El número de recepción purgado queda reservado técnicamente y ADMIN/empleado/autorización rápida no pueden reutilizarlo para otro vehículo.
- Papelera sigue siendo recuperable; la limpieza exhaustiva ocurre únicamente después de la purga definitiva confirmada por el servidor.
- Conserva la protección V4.15 que impide que una caché visual de facturas cree facturas fantasma en expedientes nuevos.
- No requiere cambios en Apps Script.


## V4.17
- Corrige desbordamiento de cuota de localStorage al cargar fotografías desde Drive.
- Los medios confirmados en nube permanecen como referencias Drive en el estado local; las imágenes hidratadas viven solo en memoria/Cache Storage.
- Migra automáticamente residuos V4.16 de expedientes ya confirmados en Drive sin borrar datos del servidor.
- Un fallo de cache local ya no puede dejar ADMIN o empleado con dashboard vacío.


## V4.18 — Integridad y carga progresiva

### Miniaturas progresivas en ADMIN y empleados
- ADMIN y los módulos de empleados cargan primero los datos del expediente y solicitan únicamente la fotografía frontal como miniatura.
- La miniatura se reduce localmente y se guarda en Cache Storage por `fileId`; las fotografías completas se descargan solo al abrir el expediente o una imagen concreta.
- Escritorio y móvil reservan siempre un espacio de miniatura. Mientras carga se muestra un esqueleto; si el expediente realmente no tiene fotografía se indica `Sin fotografía` en lugar de ocultar el vehículo.
- Un fallo individual de miniatura no puede poner el dashboard en cero ni impedir cargar otros expedientes.

- El Dashboard aplica primero los datos del workspace; las fotografías cargan después sin bloquear la lista de vehículos.
- Una fotografía ausente o lenta no puede dejar ADMIN o empleado en cero.
- El módulo de empleado conserva referencias Drive existentes y nunca las reemplaza por cadenas vacías al liberar caché visual.
- La hidratación visual de fotografías usa concurrencia limitada; las facturas se cargan bajo demanda.
- Incluye `recuperar-cache.html`, herramienta de solo lectura para intentar recuperar medios que aún sobrevivan en el navegador.
- Requiere backend V4.18 para la protección definitiva contra borrado físico accidental de medios.

## V4.18.1 — Experiencia de carga
- Misma protección de integridad del backend V4.18.
- Dashboard ADMIN y empleado: solo precarga una miniatura frontal por expediente.
- Las fotografías completas, tarjetas y facturas se cargan al abrirlas.
- Móvil y escritorio comparten el mismo comportamiento.
- Se actualizó el cache-busting de recursos para impedir que GitHub Pages reutilice JavaScript antiguo.
