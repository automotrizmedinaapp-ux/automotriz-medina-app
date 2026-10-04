# Automotriz Medina V4.16

Frontend estático preparado para GitHub Pages.

- No contiene el código privado de Google Apps Script.
- No contiene BAT, PowerShell, diagnósticos ni archivos históricos de pruebas.
- El backend se administra por separado y debe responder con `backendBuild: v4-stage4.10-2026-10-03`.
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
