// Tablero Avisos
//
// Sincroniza Tablero con Recordatorios de Apple, en los dos sentidos. Cada columna es
// una lista («Tablero · Trabajo»…) con sus tareas pendientes; Recordatorios lo lleva por
// iCloud al iPhone, que avisa a su hora. Lo que se añade, cambia, completa, mueve de
// lista o borra en el iPhone vuelve a Tablero.
//
// Corre en segundo plano (LaunchAgent com.tablero.avisos) y habla con el servidor local:
// escucha sus cambios (/api/eventos), le manda los del iPhone (/api/operaciones) y le
// cuenta su estado (/api/avisos). La lógica de fusión está en Modelo.swift.

import AppKit
import EventKit

struct Fallo: LocalizedError {
    let errorDescription: String?
    init(_ mensaje: String) { errorDescription = mensaje }
}

func registrar(_ mensaje: String) {
    print("\(ISO8601DateFormatter().string(from: Date()))  \(mensaje)")
}

func colorDeLista(_ clave: String) -> CGColor {
    let colores: [String: NSColor] = [
        "blue": .systemBlue, "indigo": .systemIndigo, "purple": .systemPurple, "pink": .systemPink,
        "red": .systemRed, "orange": .systemOrange, "yellow": .systemYellow, "green": .systemGreen,
        "mint": .systemMint, "teal": .systemTeal, "brown": .systemBrown, "gray": .systemGray,
    ]
    return (colores[clave] ?? .systemBlue).cgColor
}

extension EKReminder {
    func instantanea(columna: String) -> Instantanea {
        let (dia, hora) = diaYHora(de: dueDateComponents)
        var avisos: [Int] = []
        if let dia, let inicio = referencia(dia: dia, hora: hora) {
            avisos = (alarms ?? []).filter { $0.structuredLocation == nil }.map { alarma in
                if let fecha = alarma.absoluteDate { return minutos(desde: inicio, hasta: fecha) }
                return Int((alarma.relativeOffset / 60).rounded())
            }
        }
        return Instantanea(titulo: title ?? "", notas: notes ?? "", hecha: isCompleted, dia: dia, hora: hora,
                           avisos: normalizar(avisos), columna: columna)
    }
}

@MainActor
final class Sincronizador {
    private let servidor: URL
    private let carpeta: URL
    private var store = EKEventStore()
    private var estado: EstadoSync
    private var espera: Task<Void, Never>?
    private var sincronizando = false
    private var otraVez = false
    private var repasar = false
    private var informe = Data()

    private var archivoEstado: URL { carpeta.appending(path: "sincronizacion.json") }

    init() {
        let entorno = ProcessInfo.processInfo.environment
        servidor = URL(string: "http://127.0.0.1:\(entorno["PORT"] ?? "4747")/")!
        carpeta = entorno["TABLERO_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/Tablero/datos")
        estado = EstadoSync()
        if let datos = try? Data(contentsOf: archivoEstado), let guardado = try? JSONDecoder().decode(EstadoSync.self, from: datos) {
            estado = guardado
        }
    }

    private var conPermiso: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    func arrancar() {
        escuchar()
        Task { await esperarPermiso() }
    }

    private func esperarPermiso() async {
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined {
            informar(estado: "iniciando")
            registrar("Pidiendo permiso para Recordatorios…")
            _ = try? await store.requestFullAccessToReminders()
        }
        while !conPermiso {
            informar(estado: "sin-permiso")
            // Si lo activan en Ajustes del Sistema, se sigue sin reiniciar.
            try? await Task.sleep(for: .seconds(5))
        }
        registrar("Permiso concedido")
        store = EKEventStore()
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.programar() }
        }
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.programar() }
        }
        programar()
    }

    /// Escucha al servidor: cada cambio en el tablero dispara una sincronización.
    private func escuchar() {
        Task {
            while true {
                do {
                    var peticion = URLRequest(url: servidor.appending(path: "api/eventos")
                        .appending(queryItems: [URLQueryItem(name: "cliente", value: "avisos")]))
                    peticion.timeoutInterval = 90
                    let (bytes, respuesta) = try await URLSession.shared.bytes(for: peticion)
                    guard (respuesta as? HTTPURLResponse)?.statusCode == 200 else { throw Fallo("Sin servidor") }
                    var evento = "message"
                    for try await linea in bytes.lines {
                        if linea.hasPrefix("event:") {
                            evento = linea.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if linea.hasPrefix("data:") {
                            if evento == "hola" { enviarInforme() }
                            if evento == "hola" || evento == "rev" { programar() }
                            evento = "message"
                        }
                    }
                } catch {
                    // El servidor se ha reiniciado o aún no ha arrancado: se reintenta.
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    /// Sincroniza dentro de un momento; las llamadas seguidas se juntan en una.
    func programar(en demora: Duration = .milliseconds(600)) {
        espera?.cancel()
        espera = Task {
            try? await Task.sleep(for: demora)
            guard !Task.isCancelled else { return }
            // En otra tarea: cancelar la espera nunca cancela una sincronización ya en marcha.
            Task { await self.sincronizar() }
        }
    }

    private func sincronizar() async {
        guard conPermiso else { return }
        if sincronizando {
            otraVez = true
            return
        }
        sincronizando = true
        defer {
            sincronizando = false
            if otraVez {
                otraVez = false
                programar()
            } else if repasar {
                repasar = false
                programar(en: .seconds(40))
            }
        }
        do {
            try await enviarPendientes()
            let (datos, _) = try await URLSession.shared.data(from: servidor.appending(path: "api/board"))
            guard let tablero = try JSONDecoder().decode(Respuesta.self, from: datos).board else { return }
            let (listas, recreadas) = try asegurarListas(tablero)
            try await migrarDesdeV1(tablero, listas: listas)
            let avisos = try await reconciliar(tablero, listas: listas, recreadas: recreadas)
            informar(estado: "activo", lista: listas.values.first, listas: listas.count, programados: avisos)
        } catch {
            registrar("Error: \(error.localizedDescription)")
            informar(estado: "error", mensaje: error.localizedDescription)
        }
    }

    // MARK: Listas (una por columna)

    private var operacionesColumnas: [[String: Any]] = []

    private func asegurarListas(_ tablero: Tablero) throws -> (listas: [String: EKCalendar], recreadas: Set<String>) {
        var listas: [String: EKCalendar] = [:]
        var recreadas = Set<String>()
        operacionesColumnas = []

        for columna in tablero.columns {
            if let enlace = estado.columnas[columna.id], let lista = store.calendar(withIdentifier: enlace.lista) {
                var nombre = columna.name
                let enIPhone = nombreColumna(deLista: lista.title)
                if columna.name == enlace.nombre, enIPhone != enlace.nombre, !enIPhone.isEmpty {
                    // Renombrada en el iPhone: se renombra la columna.
                    operacionesColumnas.append(["op": "renombrarColumna", "id": columna.id, "name": enIPhone])
                    nombre = enIPhone
                    registrar("Columna renombrada desde Recordatorios: \(enIPhone)")
                }
                var cambia = false
                if lista.title != tituloLista(nombre) {
                    lista.title = tituloLista(nombre)
                    cambia = true
                }
                if columna.color != enlace.color {
                    lista.cgColor = colorDeLista(columna.color)
                    cambia = true
                }
                if cambia { try store.saveCalendar(lista, commit: true) }
                estado.columnas[columna.id] = ListaEnlazada(lista: lista.calendarIdentifier, nombre: nombre, color: columna.color)
                listas[columna.id] = lista
            } else {
                if estado.columnas[columna.id] != nil {
                    // La borraron en el iPhone: las columnas se borran desde Tablero, así que se rehace.
                    recreadas.insert(columna.id)
                    registrar("La lista de «\(columna.name)» había desaparecido: se vuelve a crear")
                }
                let lista = try crearLista(columna)
                estado.columnas[columna.id] = ListaEnlazada(lista: lista.calendarIdentifier, nombre: columna.name, color: columna.color)
                listas[columna.id] = lista
            }
        }

        // Columnas borradas en Tablero: fuera su lista (y sus recordatorios).
        for (id, enlace) in estado.columnas where listas[id] == nil {
            if let lista = store.calendar(withIdentifier: enlace.lista) {
                try store.removeCalendar(lista, commit: true)
                registrar("Lista borrada: \(lista.title)")
            }
            estado.columnas[id] = nil
            for (tarea, e) in estado.tareas where e.ultima.columna == id { estado.tareas[tarea] = nil }
        }
        return (listas, recreadas)
    }

    private func crearLista(_ columna: Columna) throws -> EKCalendar {
        let titulo = tituloLista(columna.name)
        let enlazadas = Set(estado.columnas.values.map(\.lista))
        if let existente = store.calendars(for: .reminder).first(where: { $0.title == titulo && !enlazadas.contains($0.calendarIdentifier) }) {
            return existente
        }
        guard let cuenta = store.defaultCalendarForNewReminders()?.source
            ?? store.sources.first(where: { $0.sourceType == .local }) else {
            throw Fallo("No hay ninguna cuenta de Recordatorios en este Mac")
        }
        let lista = EKCalendar(for: .reminder, eventStore: store)
        lista.title = titulo
        lista.source = cuenta
        lista.cgColor = colorDeLista(columna.color)
        try store.saveCalendar(lista, commit: true)
        registrar("Lista creada: \(titulo) (\(cuenta.title))")
        return lista
    }

    // MARK: Tareas ⇄ recordatorios

    private func recordatorios(en listas: [EKCalendar]) async throws -> [EKReminder] {
        guard !listas.isEmpty else { return [] }
        return try await buscar(store.predicateForReminders(in: listas))
    }

    private func buscar(_ predicado: NSPredicate) async throws -> [EKReminder] {
        let encontrados: [EKReminder]? = await withCheckedContinuation { continuacion in
            store.fetchReminders(matching: predicado) { continuacion.resume(returning: $0) }
        }
        // Sin respuesta no se sabe nada: mejor no sincronizar que creer que se ha borrado todo.
        guard let encontrados else { throw Fallo("No se pudieron leer los recordatorios") }
        return encontrados
    }

    /// Devuelve cuántos avisos quedan programados.
    private func reconciliar(_ tablero: Tablero, listas: [String: EKCalendar], recreadas: Set<String>) async throws -> Int {
        var ops = operacionesColumnas
        let columnaDeLista = Dictionary(uniqueKeysWithValues: listas.map { ($0.value.calendarIdentifier, $0.key) })
        let todos = try await recordatorios(en: Array(listas.values))
        var porId: [String: EKReminder] = [:]
        var porExterno: [String: EKReminder] = [:]
        for r in todos {
            porId[r.calendarItemIdentifier] = r
            if let externo = r.calendarItemExternalIdentifier { porExterno[externo] = r }
        }
        var usados = Set<String>()
        var vistas = Set<String>()
        var desaparecidas: [String] = []
        var nuevas: [(Tarea, Columna)] = []
        let enlazadasAntes = estado.tareas.count

        // 1. Tareas que ya tenían recordatorio: fusión a tres bandas.
        for columna in tablero.columns {
            for tarea in columna.tasks {
                vistas.insert(tarea.id)
                guard var enlace = estado.tareas[tarea.id] else {
                    if !tarea.done { nuevas.append((tarea, columna)) }
                    continue
                }
                guard let r = porId[enlace.recordatorio] ?? enlace.externo.flatMap({ porExterno[$0] }) else {
                    if recreadas.contains(enlace.ultima.columna) || recreadas.contains(columna.id) {
                        estado.tareas[tarea.id] = nil
                        if !tarea.done { nuevas.append((tarea, columna)) }
                    } else {
                        desaparecidas.append(tarea.id)
                    }
                    continue
                }
                usados.insert(r.calendarItemIdentifier)
                estado.ausentes[tarea.id] = nil
                let enTablero = tarea.instantanea(columna: columna.id)
                let enIPhone = r.instantanea(columna: columnaDeLista[r.calendar.calendarIdentifier] ?? columna.id)
                let fusion = fusionar(base: enlace.ultima, tablero: enTablero, recordatorio: enIPhone)
                if fusion != enTablero {
                    let cambios = cambiosParaTablero(desde: enTablero, hasta: fusion, completadaEn: r.completionDate.map(iso))
                    if !cambios.isEmpty { ops.append(["op": "actualizarTarea", "id": tarea.id, "cambios": cambios]) }
                    if fusion.columna != enTablero.columna { ops.append(["op": "moverTarea", "id": tarea.id, "columna": fusion.columna]) }
                    registrar("Desde Recordatorios: \(fusion.titulo)")
                }
                if fusion != enIPhone, let lista = listas[fusion.columna] {
                    aplicar(fusion, a: r, lista: lista, completadaEn: tarea.completedAt)
                    try store.save(r, commit: true)
                    registrar("Actualizado: \(fusion.titulo)")
                }
                enlace.ultima = fusion
                enlace.recordatorio = r.calendarItemIdentifier
                enlace.externo = r.calendarItemExternalIdentifier ?? enlace.externo
                estado.tareas[tarea.id] = enlace
            }
        }

        // 2. Recordatorios sin su tarea: o se borró en Tablero, o se creó en el iPhone.
        var tareaDe: [String: String] = [:]
        for (id, enlace) in estado.tareas where !vistas.contains(id) { tareaDe[enlace.recordatorio] = id }
        for r in todos where !usados.contains(r.calendarItemIdentifier) {
            if let id = tareaDe[r.calendarItemIdentifier] {
                try store.remove(r, commit: true)
                estado.tareas[id] = nil
                registrar("Quitado (borrado en Tablero): \(r.title ?? "")")
                continue
            }
            guard let columnaId = columnaDeLista[r.calendar.calendarIdentifier] else { continue }
            let enIPhone = r.instantanea(columna: columnaId)
            // ¿Es una tarea cuyo recordatorio creíamos perdido? (iCloud a veces cambia los identificadores)
            if let i = desaparecidas.firstIndex(where: { estado.tareas[$0]?.ultima.pareceLaMisma(que: enIPhone) == true }) {
                let id = desaparecidas.remove(at: i)
                estado.tareas[id]?.recordatorio = r.calendarItemIdentifier
                estado.tareas[id]?.externo = r.calendarItemExternalIdentifier
                estado.ausentes[id] = nil
                otraVez = true // Se fusiona en la siguiente pasada.
                continue
            }
            if r.isCompleted { continue } // Completados antiguos sin tarea: se dejan como están.
            let id = UUID().uuidString.lowercased()
            ops.append(["op": "crearTarea", "id": id, "columna": columnaId, "tarea": tareaNueva(enIPhone)])
            estado.tareas[id] = Enlace(recordatorio: r.calendarItemIdentifier, externo: r.calendarItemExternalIdentifier, ultima: enIPhone)
            vistas.insert(id)
            registrar("Nueva desde Recordatorios: \(enIPhone.titulo)")
        }

        // 3. Enlaces de tareas que ya no existen en ningún lado.
        for id in estado.tareas.keys where !vistas.contains(id) { estado.tareas[id] = nil }

        // 4. Borradas en el iPhone: se confirma pasado un rato (por si es iCloud resincronizando)
        //    y nunca en bloque sospechoso.
        let ahora = Date()
        for id in estado.ausentes.keys where !desaparecidas.contains(id) { estado.ausentes[id] = nil }
        var confirmadas: [String] = []
        for id in desaparecidas {
            if let desde = estado.ausentes[id] {
                if ahora.timeIntervalSince(desde) >= 30 { confirmadas.append(id) }
            } else {
                estado.ausentes[id] = ahora
            }
        }
        if confirmadas.count < desaparecidas.count { repasar = true }
        if borradoSospechoso(borrados: confirmadas.count, enlazados: enlazadasAntes) {
            registrar("Faltan \(confirmadas.count) recordatorios de golpe: por precaución no se borra nada en Tablero")
        } else {
            for id in confirmadas {
                ops.append(["op": "borrarTarea", "id": id])
                registrar("Borrada desde Recordatorios: \(estado.tareas[id]?.ultima.titulo ?? id)")
                estado.tareas[id] = nil
                estado.ausentes[id] = nil
            }
        }

        // 5. Tareas nuevas en Tablero: su recordatorio.
        for (tarea, columna) in nuevas {
            guard let lista = listas[columna.id] else { continue }
            let r = EKReminder(eventStore: store)
            let instantanea = tarea.instantanea(columna: columna.id)
            aplicar(instantanea, a: r, lista: lista, completadaEn: tarea.completedAt)
            try store.save(r, commit: true)
            estado.tareas[tarea.id] = Enlace(recordatorio: r.calendarItemIdentifier, externo: r.calendarItemExternalIdentifier, ultima: instantanea)
            registrar("Creado: \(instantanea.titulo)")
        }

        // 6. Se guarda todo (con lo que hay que mandar a Tablero) y se manda.
        if !ops.isEmpty {
            estado.pendientes = try JSONSerialization.data(withJSONObject: ["ops": ops])
        }
        guardarEstado()
        try await enviarPendientes()
        return estado.tareas.values.filter { !$0.ultima.hecha && $0.ultima.dia != nil && !$0.ultima.avisos.isEmpty }.count
    }

    private func aplicar(_ s: Instantanea, a r: EKReminder, lista: EKCalendar, completadaEn: String?) {
        let antes = r.instantanea(columna: s.columna)
        let titulo = s.titulo.isEmpty ? "Sin título" : s.titulo
        if r.title != titulo { r.title = titulo }
        if antes.notas != s.notas { r.notes = s.notas.isEmpty ? nil : s.notas }
        if r.calendar?.calendarIdentifier != lista.calendarIdentifier { r.calendar = lista }
        if r.isCompleted != s.hecha {
            r.isCompleted = s.hecha
            if s.hecha, let fecha = completadaEn.flatMap(fechaISO) { r.completionDate = fecha }
        }
        if antes.dia != s.dia || antes.hora != s.hora {
            r.dueDateComponents = componentes(dia: s.dia, hora: s.hora)
        }
        if antes.dia != s.dia || antes.hora != s.hora || antes.avisos != s.avisos {
            r.alarms?.forEach(r.removeAlarm)
            if let dia = s.dia, let inicio = referencia(dia: dia, hora: s.hora) {
                for m in s.avisos { r.addAlarm(EKAlarm(absoluteDate: inicio.addingTimeInterval(TimeInterval(m * 60)))) }
            }
        }
    }

    private func enviarPendientes() async throws {
        guard let cuerpo = estado.pendientes else { return }
        var peticion = URLRequest(url: servidor.appending(path: "api/operaciones"))
        peticion.httpMethod = "POST"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.httpBody = cuerpo
        let (_, respuesta) = try await URLSession.shared.data(for: peticion)
        guard (respuesta as? HTTPURLResponse)?.statusCode == 200 else { throw Fallo("Tablero no aceptó los cambios de Recordatorios") }
        estado.pendientes = nil
        guardarEstado()
    }

    // MARK: Paso desde la versión 1 (una sola lista «Tablero» con las tareas con fecha)

    private func migrarDesdeV1(_ tablero: Tablero, listas: [String: EKCalendar]) async throws {
        let archivo = carpeta.appending(path: "avisos.json")
        guard let datos = try? Data(contentsOf: archivo), let memoria = try? JSONDecoder().decode(MemoriaV1.self, from: datos) else { return }
        registrar("Pasando los avisos a una lista por columna…")
        var columnaDeTarea: [String: (Tarea, Columna)] = [:]
        for columna in tablero.columns { for tarea in columna.tasks { columnaDeTarea[tarea.id] = (tarea, columna) } }

        for (id, enlace) in memoria.enlaces where estado.tareas[id] == nil && enlace.descartado != true {
            guard let r = store.calendarItem(withIdentifier: enlace.recordatorio) as? EKReminder,
                  let (tarea, columna) = columnaDeTarea[id], let lista = listas[columna.id] else { continue }
            r.calendar = lista
            try store.save(r, commit: true)
            // Se enlaza como si estuviera igual que en Tablero: la fusión trae lo cambiado en el iPhone.
            estado.tareas[id] = Enlace(recordatorio: r.calendarItemIdentifier, externo: r.calendarItemExternalIdentifier,
                                       ultima: tarea.instantanea(columna: columna.id))
        }
        // Lo que quedara en la lista antigua (pendiente) pasa a la primera columna; luego se quita.
        if let id = memoria.lista, let antigua = store.calendar(withIdentifier: id), !listas.values.contains(where: { $0.calendarIdentifier == id }) {
            if let primera = tablero.columns.first.flatMap({ listas[$0.id] }) {
                let pendientes = try await buscar(store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [antigua]))
                for r in pendientes {
                    r.calendar = primera
                    try store.save(r, commit: true)
                }
            }
            try store.removeCalendar(antigua, commit: true)
            registrar("Lista antigua «\(antigua.title)» retirada")
        }
        guardarEstado()
        try? FileManager.default.moveItem(at: archivo, to: carpeta.appending(path: "avisos-v1.json"))
    }

    private func guardarEstado() {
        do {
            try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
            try JSONEncoder().encode(estado).write(to: archivoEstado, options: .atomic)
        } catch {
            registrar("No se pudo guardar sincronizacion.json: \(error.localizedDescription)")
        }
    }

    // MARK: Estado para la app (icono de la campana)

    private func informar(estado: String, lista: EKCalendar? = nil, listas: Int? = nil, programados: Int? = nil, mensaje: String? = nil) {
        var cuerpo: [String: Any] = ["estado": estado, "sincronizacion": 2]
        if let lista {
            cuerpo["cuenta"] = lista.source.title
            cuerpo["icloud"] = lista.source.sourceType == .calDAV && lista.source.title.localizedCaseInsensitiveContains("icloud")
        }
        if let listas { cuerpo["listas"] = listas }
        if let programados { cuerpo["programados"] = programados }
        if let mensaje { cuerpo["mensaje"] = mensaje }
        guard let datos = try? JSONSerialization.data(withJSONObject: cuerpo, options: .sortedKeys), datos != informe else { return }
        informe = datos
        registrar("Estado: \(String(decoding: datos, as: UTF8.self))")
        enviarInforme()
    }

    private func enviarInforme() {
        guard !informe.isEmpty else { return }
        var peticion = URLRequest(url: servidor.appending(path: "api/avisos"))
        peticion.httpMethod = "PUT"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.httpBody = informe
        Task { _ = try? await URLSession.shared.data(for: peticion) }
    }
}

// MARK: - Arranque (app sin icono en el Dock)

final class Delegado: NSObject, NSApplicationDelegate {
    private var sincronizador: Sincronizador?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let sincronizador = Sincronizador()
        self.sincronizador = sincronizador
        sincronizador.arrancar()
    }
}

@main
enum Principal {
    @MainActor
    static func main() {
        setvbuf(stdout, nil, _IOLBF, 0)
        registrar("Tablero Avisos arrancado")
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegado = Delegado()
        app.delegate = delegado
        withExtendedLifetime(delegado) { app.run() }
    }
}
