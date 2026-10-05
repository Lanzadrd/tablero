// Atajos de teclado globales con RegisterEventHotKey (Carbon): funcionan desde cualquier app
// y, a diferencia de vigilar el teclado, no necesitan el permiso de Accesibilidad.

import AppKit
import Carbon.HIToolbox

@MainActor
final class AtajosGlobales {
    private var registrados: [EventHotKeyRef] = []
    private var acciones: [UInt32: () -> Void] = [:]
    private var siguiente: UInt32 = 1
    private var manejador: EventHandlerRef?

    init() {
        var tipo = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let estado = InstallEventHandler(GetApplicationEventTarget(), { _, evento, contexto in
            guard let evento, let contexto else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let leido = GetEventParameter(evento, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                          nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard leido == noErr else { return leido }
            let atajos = Unmanaged<AtajosGlobales>.fromOpaque(contexto).takeUnretainedValue()
            // Carbon entrega los eventos en el hilo principal.
            MainActor.assumeIsolated { atajos.pulsado(id.id) }
            return noErr
        }, 1, &tipo, Unmanaged.passUnretained(self).toOpaque(), &manejador)
        if estado != noErr { registrar("No se pudo preparar los atajos de teclado (error \(estado))") }
    }

    /// Registra el atajo; si otra app ya lo usa (o falla), lo deja en el registro y devuelve false.
    func activar(_ atajo: Atajo, accion: @escaping () -> Void) -> Bool {
        let id = siguiente
        siguiente += 1
        var referencia: EventHotKeyRef?
        let firma = OSType(0x5442_4C52) // «TBLR»
        let estado = RegisterEventHotKey(atajo.tecla, atajo.modificadoresCarbon, EventHotKeyID(signature: firma, id: id),
                                         GetApplicationEventTarget(), 0, &referencia)
        guard estado == noErr, let referencia else {
            let motivo = estado == OSStatus(eventHotKeyExistsErr) ? "ya lo usa otra app" : "error \(estado)"
            registrar("No se pudo activar el atajo \(atajo.descripcion) (\(motivo)): queda sin atajo")
            return false
        }
        registrados.append(referencia)
        acciones[id] = accion
        return true
    }

    func quitarTodos() {
        for referencia in registrados { UnregisterEventHotKey(referencia) }
        registrados = []
        acciones = [:]
    }

    private func pulsado(_ id: UInt32) {
        acciones[id]?()
    }
}
