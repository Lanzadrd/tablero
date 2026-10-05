// Captura rápida: la petición al servidor local (POST /api/capturar). Solo Foundation.

import Foundation

struct ClienteCaptura {
    let servidor: URL

    /// Con `vistaPrevia` el servidor solo interpreta el texto (título, fecha, columna) sin guardar nada.
    func enviar(texto: String, pagina: Pagina?, vistaPrevia: Bool) async throws -> RespuestaCaptura {
        var peticion = URLRequest(url: servidor.appending(path: "api/capturar"))
        peticion.httpMethod = "POST"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.timeoutInterval = vistaPrevia ? 4 : 10
        peticion.httpBody = try JSONSerialization.data(withJSONObject: cuerpoCaptura(texto: texto, pagina: pagina, vistaPrevia: vistaPrevia))

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await URLSession.shared.data(for: peticion)
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw Fallo("Tablero no responde")
        }
        let estado = (respuesta as? HTTPURLResponse)?.statusCode ?? 0
        guard estado == 200 else { throw Fallo(mensajeDeError(datos, estado: estado)) }
        do {
            return try JSONDecoder().decode(RespuestaCaptura.self, from: datos)
        } catch {
            throw Fallo("Respuesta de Tablero no válida")
        }
    }
}
