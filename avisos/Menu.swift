// Icono de Tablero en la barra de menús: captura rápida (también con atajos globales),
// abrir Tablero y el estado de la sincronización con Recordatorios.

import AppKit

@MainActor
final class BarraDeMenus: NSObject, NSMenuDelegate {
    private let servidor: URL
    private let archivoAjustes: URL
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let menu = NSMenu()
    private let nueva = NSMenuItem(title: "Nueva tarea…", action: nil, keyEquivalent: "")
    private let conPagina = NSMenuItem(title: "Nueva tarea con la página de Chrome", action: nil, keyEquivalent: "")
    private let abrir = NSMenuItem(title: "Abrir Tablero", action: nil, keyEquivalent: "")
    private let lineaEstado = NSMenuItem(title: textoEstado("iniciando", mensaje: nil), action: nil, keyEquivalent: "")
    private let captura: Captura
    private let atajos = AtajosGlobales()
    private var ajustes: AjustesCaptura?

    init(servidor: URL, carpeta: URL) {
        self.servidor = servidor
        archivoAjustes = carpeta.appending(path: "ajustes.json")
        captura = Captura(servidor: servidor)
        super.init()

        if let boton = item.button {
            boton.image = Self.icono()
            boton.toolTip = "Tablero"
            boton.setAccessibilityLabel("Tablero")
        }
        nueva.action = #selector(nuevaTarea)
        conPagina.action = #selector(nuevaTareaConPagina)
        abrir.action = #selector(abrirTablero)
        for elemento in [nueva, conPagina, abrir] { elemento.target = self }
        lineaEstado.isEnabled = false // Solo informa.
        menu.autoenablesItems = false
        menu.items = [nueva, conPagina, .separator(), abrir, .separator(), lineaEstado]
        menu.delegate = self
        item.menu = menu
        cargarAtajos()
    }

    func mostrarEstado(_ estado: String, mensaje: String?) {
        lineaEstado.title = textoEstado(estado, mensaje: mensaje)
    }

    // Al abrir el menú se vuelve a leer ajustes.json: un atajo cambiado se aplica sin reiniciar.
    func menuWillOpen(_ menu: NSMenu) {
        cargarAtajos()
    }

    // MARK: Atajos

    private func cargarAtajos() {
        let (leidos, avisos) = leerAjustesCaptura(try? Data(contentsOf: archivoAjustes))
        guard leidos != ajustes else { return }
        ajustes = leidos
        avisos.forEach { registrar($0) }
        atajos.quitarTodos()
        configurar(nueva, leidos.captura) { [weak self] in self?.captura.alternar(conPagina: false) }
        configurar(conPagina, leidos.capturaConPagina) { [weak self] in self?.captura.alternar(conPagina: true) }
    }

    /// Activa el atajo global y lo muestra en el menú; si no se puede, el elemento queda sin atajo.
    private func configurar(_ elemento: NSMenuItem, _ atajo: Atajo?, accion: @escaping () -> Void) {
        guard let atajo, atajos.activar(atajo, accion: accion) else {
            elemento.keyEquivalent = ""
            elemento.keyEquivalentModifierMask = []
            return
        }
        elemento.keyEquivalent = atajo.equivalenteMenu
        var modificadores: NSEvent.ModifierFlags = []
        if atajo.comando { modificadores.insert(.command) }
        if atajo.opcion { modificadores.insert(.option) }
        if atajo.control { modificadores.insert(.control) }
        if atajo.mayusculas { modificadores.insert(.shift) }
        elemento.keyEquivalentModifierMask = modificadores
        registrar("Atajo \(atajo.descripcion): \(elemento.title)")
    }

    // MARK: Acciones

    @objc private func nuevaTarea(_ sender: Any?) {
        captura.mostrar(conPagina: false)
    }

    @objc private func nuevaTareaConPagina(_ sender: Any?) {
        captura.mostrar(conPagina: true)
    }

    /// La app instalada desde Chrome si existe; si no, una ventana de app de Chrome; si no, el navegador.
    @objc private func abrirTablero(_ sender: Any?) {
        let espacio = NSWorkspace.shared
        let instalada = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Applications/Chrome Apps.localized/Tablero.app")
        if FileManager.default.fileExists(atPath: instalada.path(percentEncoded: false)) {
            espacio.openApplication(at: instalada, configuration: NSWorkspace.OpenConfiguration()) { _, error in
                if let error { registrar("No se pudo abrir Tablero: \(error.localizedDescription)") }
            }
            return
        }
        let servidor = servidor
        guard let chrome = espacio.urlForApplication(withBundleIdentifier: "com.google.Chrome") else {
            espacio.open(servidor)
            return
        }
        let configuracion = NSWorkspace.OpenConfiguration()
        // Como «open -na»: una instancia nueva le pasa --app a la que ya está abierta.
        configuracion.createsNewApplicationInstance = true
        configuracion.arguments = ["--app=\(servidor.absoluteString)"]
        espacio.openApplication(at: chrome, configuration: configuracion) { _, error in
            guard let error else { return }
            registrar("No se pudo abrir Chrome: \(error.localizedDescription)")
            NSWorkspace.shared.open(servidor)
        }
    }

    // MARK: Icono

    /// La T con sus dos ondas, como en el icono de la app, en plantilla (se adapta a la barra clara u oscura).
    private static func icono() -> NSImage {
        let imagen = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            NSColor.black.setFill()
            NSColor.black.setStroke()
            NSBezierPath(roundedRect: NSRect(x: 1, y: 3.45, width: 11.1, height: 3.4), xRadius: 1.7, yRadius: 1.7).fill()
            NSBezierPath(roundedRect: NSRect(x: 4.85, y: 3.45, width: 3.4, height: 12.6), xRadius: 1.7, yRadius: 1.7).fill()
            // Cada onda es una curva cuadrática (inicio, control, fin), dibujada como cúbica.
            for (inicio, control, fin) in [
                (NSPoint(x: 13.6, y: 3.45), NSPoint(x: 15.05, y: 5.15), NSPoint(x: 13.6, y: 6.85)),
                (NSPoint(x: 15.05, y: 2), NSPoint(x: 17.2, y: 5.15), NSPoint(x: 15.05, y: 8.3)),
            ] {
                let onda = NSBezierPath()
                onda.move(to: inicio)
                onda.curve(
                    to: fin,
                    controlPoint1: NSPoint(x: inicio.x + (control.x - inicio.x) * 2 / 3, y: inicio.y + (control.y - inicio.y) * 2 / 3),
                    controlPoint2: NSPoint(x: fin.x + (control.x - fin.x) * 2 / 3, y: fin.y + (control.y - fin.y) * 2 / 3)
                )
                onda.lineWidth = 1.6
                onda.lineCapStyle = .round
                onda.stroke()
            }
            return true
        }
        imagen.isTemplate = true
        imagen.accessibilityDescription = "Tablero"
        return imagen
    }
}
