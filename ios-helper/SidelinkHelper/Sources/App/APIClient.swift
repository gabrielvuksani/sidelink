import Foundation

enum HelperAPIError: LocalizedError {
    case invalidURL
    case unauthorized
    case server(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid backend URL"
        case .unauthorized:
            return "Unauthorized. Check helper token."
        case .server(let message):
            return message
        case .decoding:
            return "Failed to decode backend response"
        }
    }
}

struct APIClient {
    func fetchStatus(baseURL: String, token: String, deviceId: String?) async throws -> HelperStatusResponse {
        guard var components = URLComponents(string: baseURL + "/api/helper/status") else {
            throw HelperAPIError.invalidURL
        }

        if let deviceId {
            components.queryItems = [URLQueryItem(name: "deviceId", value: deviceId)]
        }

        guard let url = components.url else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }

        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }

        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Request failed")
        }

        do {
            return try JSONDecoder().decode(HelperStatusResponse.self, from: data)
        } catch {
            throw HelperAPIError.decoding
        }
    }

    func triggerRefresh(baseURL: String, token: String, installId: String) async throws {
        guard let url = URL(string: baseURL + "/api/helper/refresh") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode(["installId": installId])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }

        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }

        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Refresh failed")
        }
    }
}
