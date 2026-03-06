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
    private let requestTimeout: TimeInterval = 30
    private let maxRetries = 3
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = 300
        session = URLSession(configuration: config)
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        var attempts = 1
        var lastError: Error?

        while attempts <= maxRetries {
            do {
                let (data, response) = try await session.data(for: request)
                if let http = response as? HTTPURLResponse, shouldRetry(statusCode: http.statusCode), attempts < maxRetries {
                    try? await Task.sleep(nanoseconds: retryDelayNs(forAttempt: attempts))
                    attempts += 1
                    continue
                }
                return (data, response)
            } catch {
                lastError = error
                if !isTransientNetworkError(error) || attempts >= maxRetries {
                    break
                }
                try? await Task.sleep(nanoseconds: retryDelayNs(forAttempt: attempts))
                attempts += 1
            }
        }

        throw lastError ?? HelperAPIError.server("Request failed")
    }

    private func shouldRetry(statusCode: Int) -> Bool {
        (500 ... 599).contains(statusCode)
    }

    private func isTransientNetworkError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else {
            return true
        }

        switch urlError.code {
        case .timedOut,
             .networkConnectionLost,
             .notConnectedToInternet,
             .cannotFindHost,
             .cannotConnectToHost,
             .dnsLookupFailed,
             .resourceUnavailable,
             .internationalRoamingOff,
             .callIsActive,
             .dataNotAllowed:
            return true
        default:
            return false
        }
    }

    private func retryDelayNs(forAttempt attempt: Int) -> UInt64 {
        // Exponential backoff: 1s, 2s, 4s.
        let seconds = min(pow(2.0, Double(attempt - 1)), 4)
        return UInt64(seconds * 1_000_000_000)
    }

    private func decodeEnvelope<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
        if let value = envelope.data {
            return value
        }
        throw HelperAPIError.server(envelope.error ?? "Request failed")
    }

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

        let (data, response) = try await perform(request)
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

        let (data, response) = try await perform(request)
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

    func pair(baseURL: String, code: String) async throws -> PairResponse {
        guard let url = URL(string: baseURL + "/api/system/pair") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }

        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Pairing failed")
        }

        return try decodeEnvelope(PairResponse.self, from: data)
    }

    func fetchConfig(baseURL: String, token: String) async throws -> HelperConfigDTO {
        guard let url = URL(string: baseURL + "/api/helper/config") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Config request failed")
        }

        return try decodeEnvelope(HelperConfigDTO.self, from: data)
    }

    func listAutoRefreshStates(baseURL: String, token: String) async throws -> [AutoRefreshStateDTO] {
        guard let url = URL(string: baseURL + "/api/helper/auto-refresh-states") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Auto-refresh states request failed")
        }

        return try decodeEnvelope([AutoRefreshStateDTO].self, from: data)
    }

    func listAccounts(baseURL: String, token: String) async throws -> [AccountDTO] {
        guard let url = URL(string: baseURL + "/api/helper/accounts") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Accounts request failed")
        }

        return try decodeEnvelope([AccountDTO].self, from: data)
    }

    func listDevices(baseURL: String, token: String) async throws -> [DeviceDTO] {
        guard let url = URL(string: baseURL + "/api/helper/devices") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Devices request failed")
        }

        return try decodeEnvelope([DeviceDTO].self, from: data)
    }

    func listIpas(baseURL: String, token: String) async throws -> [IpaArtifactDTO] {
        guard let url = URL(string: baseURL + "/api/helper/ipas") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "IPAs request failed")
        }

        return try decodeEnvelope([IpaArtifactDTO].self, from: data)
    }

    func listInstallJobs(baseURL: String, token: String) async throws -> [InstallJobDetailDTO] {
        guard let url = URL(string: baseURL + "/api/helper/jobs") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Jobs request failed")
        }

        return try decodeEnvelope([InstallJobDetailDTO].self, from: data)
    }

    func getInstallJob(baseURL: String, token: String, jobId: String) async throws -> InstallJobDetailDTO {
        guard let url = URL(string: baseURL + "/api/helper/jobs/\(jobId)") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Job request failed")
        }

        return try decodeEnvelope(InstallJobDetailDTO.self, from: data)
    }

    func getInstallJobLogs(baseURL: String, token: String, jobId: String) async throws -> [InstallJobLogDTO] {
        guard let url = URL(string: baseURL + "/api/helper/jobs/\(jobId)/logs") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Job logs request failed")
        }

        return try decodeEnvelope([InstallJobLogDTO].self, from: data)
    }

    func submitInstallJob2FA(baseURL: String, token: String, jobId: String, code: String) async throws {
        guard let url = URL(string: baseURL + "/api/helper/jobs/\(jobId)/2fa") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode(["code": code])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "2FA submission failed")
        }
    }

    func listInstalledApps(baseURL: String, token: String, deviceUdid: String?) async throws -> [InstalledAppDTO] {
        guard var components = URLComponents(string: baseURL + "/api/helper/apps") else {
            throw HelperAPIError.invalidURL
        }
        if let deviceUdid, !deviceUdid.isEmpty {
            components.queryItems = [URLQueryItem(name: "deviceUdid", value: deviceUdid)]
        }
        guard let url = components.url else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Installed apps request failed")
        }

        return try decodeEnvelope([InstalledAppDTO].self, from: data)
    }

    func deleteInstalledApp(baseURL: String, token: String, appId: String) async throws {
        guard let url = URL(string: baseURL + "/api/helper/apps/\(appId)") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Delete installed app failed")
        }
    }

    func importIpaFromURL(baseURL: String, token: String, urlString: String) async throws -> IpaArtifactDTO {
        guard let url = URL(string: baseURL + "/api/helper/ipas/import-url") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode(["url": urlString])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Import failed")
        }

        return try decodeEnvelope(IpaArtifactDTO.self, from: data)
    }

    func startInstall(baseURL: String, token: String, ipaId: String, accountId: String, deviceUdid: String) async throws -> InstallJobDTO {
        guard let url = URL(string: baseURL + "/api/helper/install") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode([
            "ipaId": ipaId,
            "accountId": accountId,
            "deviceUdid": deviceUdid,
        ])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Install failed")
        }

        return try decodeEnvelope(InstallJobDTO.self, from: data)
    }

    func fetchSourceManifest(urlString: String) async throws -> SourceManifestDTO {
        guard let url = URL(string: urlString) else {
            throw HelperAPIError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server("Source fetch failed")
        }

        do {
            return try JSONDecoder().decode(SourceManifestDTO.self, from: data)
        } catch {
            throw HelperAPIError.decoding
        }
    }
}
