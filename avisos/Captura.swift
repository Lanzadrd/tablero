// Captura rápida: un panel flotante tipo Spotlight para apuntar una tarea desde cualquier app.
// El servidor interpreta el texto («Llamar a Marta mañana 10:30 #Trabajo»); aquí solo se
// enseña su vista previa y se manda con ↩. Con la página de Chrome, la tarea la enlaza.

import AppKit

/// Panel sin bordes que sí recibe el teclado (por defecto solo lo reciben las ventanas con título).
final class PanelCaptura: NSPanel {
    var alCancelar: (() -> Void)?

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: VistaCaptura.ancho, height: 96),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isFloatingPanel = true
        level = .floating
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        animationBehavior = .utilityWindow
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        title = "Nueva tarea"
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { alCancelar?() }
}

/// Contenido del panel: campo grande, píldora con la página de Chrome y línea de vista previa.
final class VistaCaptura: NSVisualEffectView {
    /// Cabe el ejemplo del marcador entero a 20 pt (unos 520 px).
    static let ancho: CGFloat = 600
    static let radio: CGFloat = 16

    enum Tono { case normal, exito, error }

    let campo = NSTextField()
    private let pildora = PildoraPagina()
    private let linea = NSTextField(labelWithString: "")

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: Self.ancho, height: 96))
        material = .popover
        blendingMode = .behindWindow
        state = .active
        maskImage = Self.mascara(radio: Self.radio)

        let icono = NSImageView(image: NSImage(systemSymbolName: "plus.circle", accessibilityDescription: nil) ?? NSImage())
        icono.symbolConfiguration = .init(pointSize: 20, weight: .regular)
        icono.contentTintColor = .secondaryLabelColor
        icono.setContentHuggingPriority(.required, for: .horizontal)
        icono.setAccessibilityElement(false)

        campo.isBordered = false
        campo.isBezeled = false
        campo.drawsBackground = false
        campo.focusRingType = .none
        campo.font = .systemFont(ofSize: 20)
        campo.cell?.usesSingleLineMode = true
        campo.cell?.wraps = false
        campo.cell?.isScrollable = true
        campo.placeholderAttributedString = NSAttributedString(
            string: "Nueva tarea — p. ej. Llamar a Marta mañana 10:30 #Trabajo",
            attributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.tertiaryLabelColor])
        campo.setAccessibilityLabel("Nueva tarea")

        linea.font = .systemFont(ofSize: 13)
        linea.textColor = .secondaryLabelColor
        linea.lineBreakMode = .byTruncatingTail
        linea.maximumNumberOfLines = 1
        linea.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let fila = NSStackView(views: [icono, campo])
        fila.orientation = .horizontal
        fila.alignment = .centerY
        fila.spacing = 10

        let pila = NSStackView(views: [fila, pildora, linea])
        pila.orientation = .vertical
        pila.alignment = .leading
        pila.spacing = 10
        pila.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 14, right: 18)
        pila.setCustomSpacing(12, after: fila)
        pila.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pila)

        let contorno = Contorno(radio: Self.radio)
        contorno.translatesAutoresizingMaskIntoConstraints = false
        addSubview(contorno)

        let interior = Self.ancho - 36
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: Self.ancho),
            pila.leadingAnchor.constraint(equalTo: leadingAnchor),
            pila.trailingAnchor.constraint(equalTo: trailingAnchor),
            pila.topAnchor.constraint(equalTo: topAnchor),
            pila.bottomAnchor.constraint(equalTo: bottomAnchor),
            fila.widthAnchor.constraint(equalToConstant: interior),
            campo.heightAnchor.constraint(greaterThanOrEqualToConstant: 28),
            linea.widthAnchor.constraint(equalToConstant: interior),
            pildora.widthAnchor.constraint(lessThanOrEqualToConstant: interior),
            contorno.leadingAnchor.constraint(equalTo: leadingAnchor),
            contorno.trailingAnchor.constraint(equalTo: trailingAnchor),
            contorno.topAnchor.constraint(equalTo: topAnchor),
            contorno.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        mostrarPagina(nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) no se usa") }

    func mostrarPagina(_ pagina: Pagina?) {
        pildora.isHidden = pagina == nil
        if let pagina { pildora.mostrar(pagina) }
    }

    func mostrarLinea(_ texto: String, tono: Tono) {
        linea.stringValue = texto
        linea.textColor = switch tono {
        case .normal: .secondaryLabelColor
        case .exito: Self.verde
        case .error: Self.rojo
        }
    }

    // El verde y el rojo del sistema se leen mal en texto pequeño sobre el material claro:
    // en claro, unos tonos más oscuros (contraste ≥ 4,5:1).
    private static let verde = NSColor(name: "verdeCaptura") { apariencia in
        apariencia.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? .systemGreen : NSColor(srgbRed: 0.09, green: 0.47, blue: 0.19, alpha: 1)
    }
    private static let rojo = NSColor(name: "rojoCaptura") { apariencia in
        apariencia.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? .systemRed : NSColor(srgbRed: 0.74, green: 0.11, blue: 0.09, alpha: 1)
    }

    /// Esquinas redondeadas del material (la sombra de la ventana sigue esta forma).
    private static func mascara(radio: CGFloat) -> NSImage {
        let lado = radio * 2 + 1
        let imagen = NSImage(size: NSSize(width: lado, height: lado), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radio, yRadius: radio).fill()
            return true
        }
        imagen.capInsets = NSEdgeInsets(top: radio, left: radio, bottom: radio, right: radio)
        imagen.resizingMode = .stretch
        return imagen
    }
}

/// Borde fino para que el panel se distinga sobre fondos del mismo tono (sobre todo en oscuro).
private final class Contorno: NSView {
    private let radio: CGFloat

    init(radio: CGFloat) {
        self.radio = radio
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) no se usa") }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.separatorColor.setStroke()
        let camino = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: radio - 0.5, yRadius: radio - 0.5)
        camino.lineWidth = 1
        camino.stroke()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// Píldora con el título y el dominio de la página de Chrome que se va a enlazar.
private final class PildoraPagina: NSView {
    private let titulo = NSTextField(labelWithString: "")
    private let dominio = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        let icono = NSImageView(image: NSImage(systemSymbolName: "globe", accessibilityDescription: nil) ?? NSImage())
        icono.symbolConfiguration = .init(pointSize: 11, weight: .medium)
        icono.contentTintColor = .secondaryLabelColor
        icono.setContentHuggingPriority(.required, for: .horizontal)
        titulo.font = .systemFont(ofSize: 12, weight: .medium)
        titulo.lineBreakMode = .byTruncatingTail
        titulo.maximumNumberOfLines = 1
        titulo.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        // El dominio no se recorta: es lo que dice de dónde viene la página.
        dominio.font = .systemFont(ofSize: 12)
        dominio.textColor = .secondaryLabelColor
        dominio.setContentCompressionResistancePriority(.required, for: .horizontal)

        let fila = NSStackView(views: [icono, titulo, dominio])
        fila.orientation = .horizontal
        fila.alignment = .centerY
        fila.spacing = 6
        fila.setCustomSpacing(5, after: icono)
        fila.edgeInsets = NSEdgeInsets(top: 4, left: 9, bottom: 4, right: 11)
        fila.translatesAutoresizingMaskIntoConstraints = false
        addSubview(fila)
        NSLayoutConstraint.activate([
            fila.leadingAnchor.constraint(equalTo: leadingAnchor),
            fila.trailingAnchor.constraint(equalTo: trailingAnchor),
            fila.topAnchor.constraint(equalTo: topAnchor),
            fila.bottomAnchor.constraint(equalTo: bottomAnchor),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) no se usa") }

    // Dibujada (no con una capa) para que el color siga a la apariencia clara u oscura.
    override func draw(_ dirtyRect: NSRect) {
        NSColor.quaternaryLabelColor.setFill()
        let radio = bounds.height / 2
        NSBezierPath(roundedRect: bounds, xRadius: radio, yRadius: radio).fill()
    }

    func mostrar(_ pagina: Pagina) {
        titulo.stringValue = pagina.titulo
        dominio.stringValue = pagina.dominio
        dominio.isHidden = pagina.dominio == pagina.titulo
        toolTip = pagina.url
        setAccessibilityLabel("Página de Chrome: \(pagina.titulo), \(pagina.dominio)")
    }
}

// MARK: - Controlador

@MainActor
final class Captura: NSObject, NSWindowDelegate, NSTextFieldDelegate {
    private let servidor: URL
    private let cliente: ClienteCaptura
    private let panel = PanelCaptura()
    private let vista = VistaCaptura()
    private var pagina: Pagina?
    private var conPagina = false
    private var enviando = false
    private var vistaPrevia: Task<Void, Never>?
    private var cierre: Task<Void, Never>?
    /// Cada cambio lo aumenta: así se descartan las vistas previas que llegan tarde.
    private var turno = 0

    init(servidor: URL) {
        self.servidor = servidor
        cliente = ClienteCaptura(servidor: servidor)
        super.init()
        panel.contentView = vista
        panel.delegate = self
        panel.alCancelar = { [weak self] in self?.cerrar() }
        vista.campo.delegate = self
    }

    /// El atajo abre el panel; pulsado otra vez (en el mismo modo), lo cierra.
    func alternar(conPagina: Bool) {
        if panel.isVisible, conPagina == self.conPagina, cierre == nil {
            cerrar()
        } else {
            mostrar(conPagina: conPagina)
        }
    }

    func mostrar(conPagina: Bool) {
        cierre?.cancel()
        cierre = nil
        self.conPagina = conPagina
        var aviso: String?
        pagina = nil
        if conPagina {
            switch leerPestanaDeChrome() {
            case let .pagina(leida): pagina = leida
            case let .aviso(texto): aviso = texto
            }
        }
        vista.mostrarPagina(pagina)
        if let aviso {
            turno += 1
            vista.mostrarLinea(aviso, tono: .error)
        } else {
            actualizarVistaPrevia()
        }

        let estabaVisible = panel.isVisible
        ajustarAltura()
        if !estabaVisible { colocar() }
        let animar = !estabaVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        panel.alphaValue = animar ? 0 : 1
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate()
        panel.makeFirstResponder(vista.campo)
        // Si quedó un borrador, se selecciona: escribir lo sustituye.
        vista.campo.currentEditor()?.selectAll(nil)
        if animar {
            NSAnimationContext.runAnimationGroup { contexto in
                contexto.duration = 0.12
                panel.animator().alphaValue = 1
            }
        }
    }

    func cerrar() {
        cierre?.cancel()
        cierre = nil
        vistaPrevia?.cancel()
        turno += 1
        guard panel.isVisible else { return }
        panel.orderOut(nil)
        // Devuelve el foco a la app que se estaba usando.
        if NSApp.isActive { NSApp.hide(nil) }
    }

    // MARK: Campo de texto

    func controlTextDidChange(_ obj: Notification) {
        cierre?.cancel()
        cierre = nil
        actualizarVistaPrevia()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            enviar()
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            cerrar()
            return true
        default:
            return false
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        cerrar()
    }

    // MARK: Vista previa y envío

    private var texto: String { vista.campo.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func actualizarVistaPrevia() {
        vistaPrevia?.cancel()
        turno += 1
        let turno = turno
        let texto = texto
        guard !texto.isEmpty else {
            vista.mostrarLinea(pagina == nil ? "↩ para añadir · Esc para cerrar" : "↩ para añadir la página como tarea", tono: .normal)
            return
        }
        let pagina = pagina
        vistaPrevia = Task {
            // Espera a que se deje de escribir un momento.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            do {
                let respuesta = try await cliente.enviar(texto: texto, pagina: pagina, vistaPrevia: true)
                guard turno == self.turno, !enviando else { return }
                let resumen = mensajeVistaPrevia(respuesta)
                vista.mostrarLinea(resumen.isEmpty ? texto : resumen, tono: .normal)
            } catch is CancellationError {
            } catch {
                guard turno == self.turno, !enviando else { return }
                vista.mostrarLinea(error.localizedDescription, tono: .error)
            }
        }
    }

    private func enviar() {
        guard !enviando else { return }
        let texto = texto
        guard !texto.isEmpty || pagina != nil else {
            NSSound.beep()
            return
        }
        enviando = true
        vistaPrevia?.cancel()
        turno += 1
        vista.mostrarLinea("Añadiendo…", tono: .normal)
        let pagina = pagina
        Task {
            defer { enviando = false }
            do {
                let respuesta = try await cliente.enviar(texto: texto, pagina: pagina, vistaPrevia: false)
                registrar("Captura rápida: «\(respuesta.titulo ?? texto)» → \(respuesta.columna ?? "?")")
                vista.campo.stringValue = ""
                let mensaje = mensajeAnadida(respuesta)
                vista.mostrarLinea(mensaje, tono: .exito)
                anunciar(mensaje)
                cierre = Task {
                    try? await Task.sleep(for: .milliseconds(800))
                    guard !Task.isCancelled else { return }
                    cerrar()
                }
            } catch {
                // El texto se queda en el campo para poder reintentar.
                let mensaje = "No se ha podido añadir: \(error.localizedDescription)"
                registrar(mensaje)
                vista.mostrarLinea(mensaje, tono: .error)
                anunciar(mensaje)
            }
        }
    }

    private func anunciar(_ mensaje: String) {
        NSAccessibility.post(element: panel, notification: .announcementRequested,
                             userInfo: [.announcement: mensaje, .priority: NSAccessibilityPriorityLevel.high.rawValue])
    }

    // MARK: Posición

    /// Ajusta la altura al contenido sin mover el borde de arriba.
    private func ajustarAltura() {
        vista.layoutSubtreeIfNeeded()
        let alto = vista.fittingSize.height
        var marco = panel.frame
        marco.origin.y = marco.maxY - alto
        marco.size = NSSize(width: VistaCaptura.ancho, height: alto)
        panel.setFrame(marco, display: true)
        panel.invalidateShadow()
    }

    /// Centrado y en el tercio de arriba de la pantalla donde está el ratón, como Spotlight.
    private func colocar() {
        let raton = NSEvent.mouseLocation
        guard let zona = (NSScreen.screens.first { NSMouseInRect(raton, $0.frame, false) } ?? NSScreen.main)?.visibleFrame else {
            panel.center()
            return
        }
        let tamano = panel.frame.size
        panel.setFrameOrigin(NSPoint(x: (zona.midX - tamano.width / 2).rounded(),
                                     y: (zona.maxY - zona.height * 0.2 - tamano.height).rounded()))
    }

    // MARK: Chrome

    private enum Pestana {
        case pagina(Pagina)
        case aviso(String)
    }

    /// Dirección y título de la pestaña activa de Chrome (la primera ventana normal con una página
    /// web). La primera vez macOS pregunta si «Tablero Avisos» puede controlar Chrome.
    private func leerPestanaDeChrome() -> Pestana {
        guard !NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").isEmpty else {
            return .aviso("Chrome no está abierto")
        }
        // Los separadores, fuera del «tell»: dentro, «tab» sería la clase «pestaña» de Chrome.
        let fuente = """
        set separador to tab
        set salto to linefeed
        set salida to ""
        tell application id "com.google.Chrome"
            repeat with ventana in windows
                set pestana to active tab of ventana
                set salida to salida & (mode of ventana) & separador & (URL of pestana) & separador & (title of pestana) & salto
            end repeat
        end tell
        return salida
        """
        var error: NSDictionary?
        guard let resultado = NSAppleScript(source: fuente)?.executeAndReturnError(&error), error == nil else {
            let codigo = error?[NSAppleScript.errorNumber] as? Int ?? 0
            registrar("No se pudo leer la pestaña de Chrome (\(codigo)): \(error?[NSAppleScript.errorMessage] ?? "")")
            if codigo == -1743 {
                return .aviso("Sin permiso para leer Chrome: actívalo en Ajustes › Privacidad › Automatización")
            }
            return .aviso("No se ha podido leer la pestaña de Chrome")
        }
        guard let pagina = paginaDeChrome(resultado.stringValue ?? "", servidor: servidor) else {
            return .aviso("No hay ninguna página web abierta en Chrome")
        }
        return .pagina(pagina)
    }
}
