// Pruebas de la lógica del ayudante (sin EventKit ni AppKit). No forma parte de la app:
//   swiftc -parse-as-library -swift-version 5 avisos/Modelo.swift avisos/Pruebas.swift -o /tmp/pruebas && /tmp/pruebas

import Foundation

@main
enum Pruebas {
    static var fallos = 0
    static var total = 0

    static func comprobar(_ condicion: Bool, _ nombre: String) {
        total += 1
        if !condicion {
            fallos += 1
            print("✗ \(nombre)")
        }
    }

    static func main() throws {
        let base = Instantanea(titulo: "Pan", notas: "", hecha: false, dia: "2026-10-06", hora: "10:30", avisos: [0], columna: "A")

        // Fusión
        var t = base, r = base
        t.titulo = "Pan integral"
        r.hecha = true
        var m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.titulo == "Pan integral" && m.hecha, "cada lado aporta lo que cambió")

        t = base; r = base
        t.titulo = "Desde el Mac"; r.titulo = "Desde el iPhone"
        comprobar(fusionar(base: base, tablero: t, recordatorio: r).titulo == "Desde el Mac", "si cambian los dos, gana Tablero")

        t = base; r = base
        r.hora = nil; r.avisos = [540]
        t.avisos = [0, -15]
        m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.hora == "10:30" && m.avisos == [0, -15], "fecha, hora y avisos van juntos (de Tablero)")

        t = base; r = base
        r.dia = "2026-10-07"; r.columna = "B"
        m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.dia == "2026-10-07" && m.columna == "B" && m.hora == "10:30", "cambio de día y de lista en el iPhone")

        // Cambios para Tablero
        var c = cambiosParaTablero(desde: base, hasta: base, completadaEn: nil)
        comprobar(c.isEmpty, "sin cambios")
        m = base; m.hecha = true
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: "2026-10-06T08:00:00.000Z")
        comprobar(c["done"] as? Bool == true && c["completedAt"] as? String == "2026-10-06T08:00:00.000Z" && c["due"] == nil,
                  "completada en el iPhone")
        m = base; m.hora = nil; m.avisos = [540]
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar(c["time"] is NSNull && c["alerts"] is NSNull, "a todo el día con avisos por defecto → null")
        m = base; m.avisos = [-15, 0]
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar((c["alerts"] as? [Int]) == [-15, 0], "avisos propios se mandan tal cual")
        m = base; m.dia = nil; m.hora = nil; m.avisos = []
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar(c["due"] is NSNull && c["alerts"] is NSNull, "sin fecha")

        // Tarea → instantánea
        let json = #"{"id":"x","title":"Gimnasio","notes":"","done":false,"due":"2026-10-06","time":null}"#
        let tarea = try JSONDecoder().decode(Tarea.self, from: Data(json.utf8))
        comprobar(tarea.instantanea(columna: "A").avisos == [540], "todo el día: aviso a las 9:00 por defecto")
        let conHora = try JSONDecoder().decode(Tarea.self, from: Data(#"{"id":"y","due":"2026-10-06","time":"18:00","alerts":[0,-60,0]}"#.utf8))
        comprobar(conHora.instantanea(columna: "A").avisos == [0, -60], "avisos sin repetir y ordenados")
        let sinFecha = try JSONDecoder().decode(Tarea.self, from: Data(#"{"id":"z","time":"18:00","alerts":[0]}"#.utf8))
        comprobar(sinFecha.instantanea(columna: "A").hora == nil && sinFecha.instantanea(columna: "A").avisos.isEmpty, "sin fecha no hay hora ni avisos")
        let roto = Data(#"{"columns":[{"id":"A","name":"Casa","tasks":"nada"}]}"#.utf8)
        comprobar((try? JSONDecoder().decode(Tablero.self, from: roto)) == nil, "un tablero ilegible falla en vez de parecer vacío")

        // Fechas
        let (dia, hora) = diaYHora(de: componentes(dia: "2026-10-06", hora: "09:05"))
        comprobar(dia == "2026-10-06" && hora == "09:05", "fecha con hora, ida y vuelta")
        let todoElDia = diaYHora(de: componentes(dia: "2026-10-06", hora: nil))
        comprobar(todoElDia.dia == "2026-10-06" && todoElDia.hora == nil, "todo el día, ida y vuelta")
        if let inicio = referencia(dia: "2026-10-06", hora: nil), let nueve = referencia(dia: "2026-10-06", hora: "09:00") {
            comprobar(minutos(desde: inicio, hasta: nueve) == 540, "9:00 son 540 minutos desde las 0:00")
        } else {
            comprobar(false, "referencias de fecha")
        }
        comprobar(fechaISO(iso(Date(timeIntervalSince1970: 1_791_000_000))) == Date(timeIntervalSince1970: 1_791_000_000), "ISO ida y vuelta")

        // Listas y seguridad
        comprobar(nombreColumna(deLista: tituloLista("Trabajo")) == "Trabajo", "nombre de lista ↔ columna")
        comprobar(nombreColumna(deLista: "Oficina") == "Oficina", "lista renombrada sin prefijo")
        comprobar(!borradoSospechoso(borrados: 1, enlazados: 40), "borrar una tarea es normal")
        comprobar(borradoSospechoso(borrados: 30, enlazados: 40), "que falten 30 de 40 es sospechoso")
        let otra = Instantanea(titulo: "Pan", notas: "x", hecha: true, dia: "2026-10-06", hora: "10:30", avisos: [], columna: "A")
        comprobar(base.pareceLaMisma(que: otra), "reconoce una tarea aunque cambie el identificador")

        let sincronizacion = (fallos: fallos, total: total)
        try captura()
        print(fallos == 0 ? "sincronización y captura: \(total)/\(total) casos correctos"
            : "\(fallos) de \(total) fallan (sincronización: \(sincronizacion.fallos) de \(sincronizacion.total))")
        if fallos > 0 { exit(1) }
    }

    static func captura() throws {
        // Atajos
        let opcionEspacio = leerAtajo("option+space")
        comprobar(opcionEspacio == Atajo(tecla: 49, opcion: true), "option+space")
        comprobar(opcionEspacio?.modificadoresCarbon == 2048, "⌥ es optionKey (2048) en Carbon")
        comprobar(opcionEspacio?.descripcion == "⌥Espacio" && opcionEspacio?.equivalenteMenu == " ", "⌥Espacio en el menú")
        let conPagina = leerAtajo("option+shift+space")
        comprobar(conPagina?.modificadoresCarbon == 2048 | 512 && conPagina?.descripcion == "⌥⇧Espacio", "option+shift+space")
        comprobar(leerAtajo(" Opción + Mayús + Espacio ") == conPagina, "en español, con espacios y tildes")
        comprobar(leerAtajo("cmd+shift+k") == Atajo(tecla: 0x28, comando: true, mayusculas: true), "cmd+shift+k")
        comprobar(leerAtajo("ctrl+alt+t")?.descripcion == "⌃⌥T", "orden de los símbolos como en macOS")
        comprobar(leerAtajo("⌘+⇧+1")?.modificadoresCarbon == 256 | 512, "símbolos como modificadores")
        comprobar(leerAtajo("f5") == Atajo(tecla: 0x60), "F5 sin modificadores vale")
        comprobar(leerAtajo("F12")?.equivalenteMenu == "\u{F70F}", "F12 en el menú")
        comprobar(leerAtajo("space") == nil, "sin modificador no (quitaría el espacio a todas las apps)")
        comprobar(leerAtajo("shift+a") == nil, "solo ⇧ no basta")
        comprobar(leerAtajo("option+") == nil && leerAtajo("") == nil && leerAtajo("option+banana") == nil, "atajos ilegibles")
        comprobar(leerAtajo("hyper+space") == nil, "modificador desconocido")

        // Ajustes (ajustes.json)
        var (ajustes, avisos) = leerAjustesCaptura(nil)
        comprobar(ajustes.captura == opcionEspacio && ajustes.capturaConPagina == conPagina && avisos.isEmpty, "sin archivo: por defecto")
        (ajustes, avisos) = leerAjustesCaptura(Data(#"{"atajoCaptura":"ctrl+space","otraCosa":1}"#.utf8))
        comprobar(ajustes.captura == Atajo(tecla: 49, control: true) && ajustes.capturaConPagina == conPagina && avisos.isEmpty, "atajo propio")
        (ajustes, avisos) = leerAjustesCaptura(Data(#"{"atajoCaptura":"","atajoCapturaPagina":false}"#.utf8))
        comprobar(ajustes.captura == nil && ajustes.capturaConPagina == nil, "\"\" o false: sin atajo")
        (ajustes, avisos) = leerAjustesCaptura(Data(#"{"atajoCaptura":null,"atajoCapturaPagina":"nada+x"}"#.utf8))
        comprobar(ajustes.captura == opcionEspacio && ajustes.capturaConPagina == conPagina && avisos.count == 1, "null o ilegible: por defecto y aviso")
        (ajustes, avisos) = leerAjustesCaptura(Data(#"{"atajoCaptura":"option+shift+space"}"#.utf8))
        comprobar(ajustes.captura == conPagina && ajustes.capturaConPagina == nil && avisos.count == 1, "dos acciones con el mismo atajo")
        (ajustes, avisos) = leerAjustesCaptura(Data("no es json".utf8))
        comprobar(ajustes.captura == opcionEspacio && avisos.count == 1, "ajustes.json roto")

        // Página de Chrome
        let servidor = URL(string: "http://127.0.0.1:4747/")!
        var pagina = paginaDeChrome("normal\thttps://www.example.com/a?b=1\tEjemplo · Inicio\n", servidor: servidor)
        comprobar(pagina == Pagina(url: "https://www.example.com/a?b=1", titulo: "Ejemplo · Inicio") && pagina?.dominio == "example.com",
                  "pestaña activa de Chrome")
        pagina = paginaDeChrome("""
        normal\thttp://127.0.0.1:4747/\tTablero
        normal\tchrome://newtab/\tNueva pestaña
        incognito\thttps://privado.example/\tAlgo privado
        normal\thttps://es.wikipedia.org/wiki/Madrid\t
        """, servidor: servidor)
        comprobar(pagina == Pagina(url: "https://es.wikipedia.org/wiki/Madrid", titulo: "es.wikipedia.org"),
                  "salta Tablero, chrome:// e incógnito; sin título, el dominio")
        comprobar(paginaDeChrome("normal\thttps://a.es/x\tCon\ttabulador", servidor: servidor)?.titulo == "Con\ttabulador",
                  "un tabulador dentro del título no rompe nada")
        comprobar(paginaDeChrome("normal\thttp://localhost:5173/\tVite", servidor: servidor) != nil, "otro servidor local sí cuenta")
        comprobar(paginaDeChrome("", servidor: servidor) == nil && paginaDeChrome("normal\tchrome://settings\tAjustes", servidor: servidor) == nil
            && paginaDeChrome("incognito\thttps://a.es/\tA", servidor: servidor) == nil, "sin páginas web")
        comprobar(direccionServidor(["PORT": "4848"]).absoluteString == "http://127.0.0.1:4848/"
            && direccionServidor(["PORT": "x"]).port == 4747, "puerto del servidor")
        comprobar(carpetaDeDatos(["TABLERO_DATA_DIR": "/tmp/datos"]).appending(path: "ajustes.json").path == "/tmp/datos/ajustes.json",
                  "ajustes.json en la carpeta de datos")

        // Petición y respuestas de /api/capturar
        var cuerpo = cuerpoCaptura(texto: "  Llamar a Marta mañana  ", pagina: nil, vistaPrevia: true)
        comprobar(cuerpo["texto"] as? String == "Llamar a Marta mañana" && cuerpo["vistaPrevia"] as? Bool == true
            && cuerpo["url"] == nil, "cuerpo de la vista previa")
        cuerpo = cuerpoCaptura(texto: "", pagina: Pagina(url: "https://a.es/", titulo: "A"), vistaPrevia: false)
        comprobar(cuerpo["texto"] as? String == "" && cuerpo["url"] as? String == "https://a.es/" && cuerpo["tituloPagina"] as? String == "A"
            && cuerpo["vistaPrevia"] == nil, "cuerpo con la página de Chrome")
        _ = try JSONSerialization.data(withJSONObject: cuerpo)

        let decodificar = { (json: String) in try JSONDecoder().decode(RespuestaCaptura.self, from: Data(json.utf8)) }
        var respuesta = try decodificar(#"{"rev":8,"id":"t1","columna":"Trabajo","resumen":"Llamar a Marta · mañana 10:30 · Trabajo"}"#)
        comprobar(respuesta == RespuestaCaptura(rev: 8, id: "t1", resumen: "Llamar a Marta · mañana 10:30 · Trabajo", columna: "Trabajo"),
                  "respuesta al añadir")
        comprobar(mensajeAnadida(respuesta) == "✓ Añadida a Trabajo", "mensaje al añadir")
        comprobar(mensajeVistaPrevia(respuesta) == "Llamar a Marta · mañana 10:30 · Trabajo", "la vista previa es el resumen")
        respuesta = try decodificar(#"{"titulo":"Pan","columna":{"id":"c1","name":"Casa"},"rev":"raro"}"#)
        comprobar(respuesta.columna == "Casa" && respuesta.rev == nil && mensajeVistaPrevia(respuesta) == "Pan · Casa",
                  "columna como objeto y campos raros")
        respuesta = try decodificar(#"{"titulo":"Llamar a Marta","resumen":"Mañana, 10:30 · Trabajo","columna":"Trabajo"}"#)
        comprobar(mensajeVistaPrevia(respuesta) == "Llamar a Marta · Mañana, 10:30 · Trabajo", "vista previa: título, resumen y columna sin repetir")
        respuesta = try decodificar(#"{"titulo":"Comprar pan","resumen":"","columna":"Bandeja"}"#)
        comprobar(mensajeVistaPrevia(respuesta) == "Comprar pan · Bandeja", "vista previa sin nada que interpretar")
        comprobar(mensajeAnadida(RespuestaCaptura()) == "✓ Añadida", "sin columna")
        comprobar((try? decodificar("[]")) == nil, "respuesta que no es un objeto")
        comprobar(mensajeDeError(Data(#"{"error":"Texto vacío"}"#.utf8), estado: 400) == "Texto vacío", "error del servidor")
        comprobar(mensajeDeError(Data(#"{"error":"sin-tablero","mensaje":"Aún no hay tablero"}"#.utf8), estado: 409) == "Aún no hay tablero",
                  "error con código: se enseña el mensaje")
        comprobar(mensajeDeError(Data(#"{"error":"No encontrado"}"#.utf8), estado: 404) == "No encontrado"
            && mensajeDeError(Data(), estado: 404) == "Este Tablero aún no admite la captura rápida", "servidor sin captura")

        // Estado en el menú
        comprobar(textoEstado("activo", mensaje: nil) == "Sincronizado con Recordatorios", "estado sincronizado")
        comprobar(textoEstado("sin-permiso", mensaje: nil) == "Esperando permiso de Recordatorios", "estado sin permiso")
        let largo = textoEstado("error", mensaje: String(repeating: "x", count: 100))
        comprobar(largo.hasPrefix("Error: x") && largo.hasSuffix("…") && largo.count == 67, "error recortado")
    }
}
