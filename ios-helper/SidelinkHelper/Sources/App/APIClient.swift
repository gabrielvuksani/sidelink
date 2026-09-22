import Foundation

enum HelperAPIError: LocalizedError {
    case invalidURL
    case unauthorized
    case notFound(String)
    case commandRejected(statusCode: Int, code: String?, message: String)
    case server(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid backend URL"
        case .unauthorized:
            return "Unauthorized. Check helper token."
        case .notFound(let message):
            return message
        case .commandRejected(_, _, let message):
            return message
        case .server(let message):
            return message
        case .decoding:
            return "Failed to decode backend response"
        }
    }
}

struct HelperCommandErrorEnvelope: Decodable {
    let ok: Bool
    let code: String?
    let error: String?
}

struct InstallJobCommandVersionBody: Encodable {
    let expectedRevision: Int
    let expectedUpdatedAt: String
}

struct InstallJobTwoFABody: Encodable {
    let code: String
    let expectedRevision: Int
    let expectedUpdatedAt: String
}

struct APIClient: Sendable {
    enum RequestPolicy: Sendable {
        case resilient
        case foregroundLiveness
    }

    private typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private struct RequestOutput: @unchecked Sendable {
        let data: Data
        let response: URLResponse
    }

    private static let defaultForegroundDeadline: TimeInterval = 8
    private let resilientTransport: Transport
    private let foregroundTransport: Transport
    private let foregroundDeadline: TimeInterval

    init() {
        let resilientConfiguration = URLSessionConfiguration.default
        resilientConfiguration.timeoutIntervalForRequest = 30
        resilientConfiguration.timeoutIntervalForResource = 300
        resilientConfiguration.waitsForConnectivity = true
        let resilientSession = URLSession(configuration: resilientConfiguration)

        let foregroundConfiguration = URLSessionConfiguration.default
        foregroundConfiguration.timeoutIntervalForRequest = Self.defaultForegroundDeadline
        foregroundConfiguration.timeoutIntervalForResource = Self.defaultForegroundDeadline
        foregroundConfiguration.waitsForConnectivity = false
        let foregroundSession = URLSession(configuration: foregroundConfiguration)

        resilientTransport = { request in
            try await resilientSession.data(for: request)
        }
        foregroundTransport = { request in
            try await foregroundSession.data(for: request)
        }
        foregroundDeadline = Self.defaultForegroundDeadline
    }

    init(
        transport: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse),
        foregroundDeadline: TimeInterval = Self.defaultForegroundDeadline
    ) {
        resilientTransport = transport
        foregroundTransport = transport
        self.foregroundDeadline = foregroundDeadline
    }

    func perform(
        _ request: URLRequest,
        policy: RequestPolicy = .resilient
    ) async throws -> (Data, URLResponse) {
        let output: RequestOutput
        switch policy {
        case .resilient:
            output = try await performAttempts(
                request,
                policy: policy,
                transport: resilientTransport
            )
        case .foregroundLiveness:
            output = try await performWithForegroundDeadline(request)
        }
        return (output.data, output.response)
    }

    private func performWithForegroundDeadline(_ request: URLRequest) async throws -> RequestOutput {
        try await withThrowingTaskGroup(of: RequestOutput.self) { group in
            group.addTask {
                try await performAttempts(
                    request,
                    policy: .foregroundLiveness,
                    transport: foregroundTransport
                )
            }
            group.addTask {
                let nanoseconds = UInt64(max(0, foregroundDeadline) * 1_000_000_000)
                try await Task.sleep(nanoseconds: nanoseconds)
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let output = try await group.next() else {
                throw URLError(.timedOut)
            }
            return output
        }
    }

    private func performAttempts(
        _ request: URLRequest,
        policy: RequestPolicy,
        transport: Transport
    ) async throws -> RequestOutput {
        var attempts = 1
        var lastError: Error?
        let method = (request.httpMethod ?? "GET").uppercased()
        let mayRetry: Bool
        let maxAttempts: Int
        switch policy {
        case .resilient:
            let retryableMethods = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]
            mayRetry = retryableMethods.contains(method)
                || request.value(forHTTPHeaderField: "Idempotency-Key") != nil
            maxAttempts = mayRetry ? 3 : 1
        case .foregroundLiveness:
            mayRetry = method == "GET"
            maxAttempts = mayRetry ? 2 : 1
        }

        while attempts <= maxAttempts {
            if Task.isCancelled {
                throw CancellationError()
            }
            do {
                let (data, response) = try await transport(request)
                if mayRetry,
                   let http = response as? HTTPURLResponse,
                   shouldRetry(statusCode: http.statusCode),
                   attempts < maxAttempts {
                    try await Task.sleep(
                        nanoseconds: retryDelayNs(forAttempt: attempts, policy: policy)
                    )
                    attempts += 1
                    continue
                }
                return RequestOutput(data: data, response: response)
            } catch {
                lastError = error
                if Task.isCancelled {
                    throw error
                }
                if !mayRetry || !isTransientNetworkError(error) || attempts >= maxAttempts {
                    break
                }
                try await Task.sleep(
                    nanoseconds: retryDelayNs(forAttempt: attempts, policy: policy)
                )
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

    private func retryDelayNs(forAttempt attempt: Int, policy: RequestPolicy) -> UInt64 {
        switch policy {
        case .resilient:
            let seconds = min(pow(2.0, Double(attempt - 1)), 4)
            return UInt64(seconds * 1_000_000_000)
        case .foregroundLiveness:
            return 250_000_000
        }
    }

    func decodeEnvelope<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
        if let value = envelope.data {
            return value
        }
        throw HelperAPIError.server(envelope.error ?? "Request failed")
    }

    func commandRejection(
        statusCode: Int,
        data: Data,
        fallbackMessage: String
    ) -> HelperAPIError {
        let envelope = try? JSONDecoder().decode(HelperCommandErrorEnvelope.self, from: data)
        return .commandRejected(
            statusCode: statusCode,
            code: envelope?.code,
            message: envelope?.error ?? fallbackMessage
        )
    }

    func helperURL(
        baseURL: String,
        pathComponents: [String],
        queryItems: [URLQueryItem] = []
    ) -> URL? {
        guard let base = URL(string: baseURL) else {
            return nil
        }

        let url = pathComponents.reduce(base) { partial, component in
            partial.appendingPathComponent(component)
        }

        guard !queryItems.isEmpty else {
            return url
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems
        return components?.url
    }

    func fetchStatus(baseURL: String, token: String, deviceId: String?) async throws -> HelperStatusResponse {
        let queryItems = deviceId.map { [URLQueryItem(name: "deviceId", value: $0)] } ?? []
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "status"], queryItems: queryItems) else {
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

    func triggerRefresh(
        baseURL: String,
        token: String,
        installId: String,
        idempotencyKey: String
    ) async throws -> RefreshJobReceiptDTO {
        guard let url = URL(string: baseURL + "/api/helper/refresh") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(["installId": installId])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }

        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        if http.statusCode == 404 {
            throw HelperAPIError.notFound("This operation is no longer available on the desktop.")
        }

        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Refresh failed")
        }

        let decoder = JSONDecoder()
        if let envelope = try? decoder.decode(APIEnvelope<RefreshJobReceiptDTO>.self, from: data) {
            if let receipt = envelope.data {
                return receipt
            }
            if !envelope.ok {
                throw HelperAPIError.server(envelope.error ?? "Refresh failed")
            }
        }

        if let legacy = try? decoder.decode(LegacyRefreshAcceptanceDTO.self, from: data), legacy.ok {
            return RefreshJobReceiptDTO(disposition: "accepted", job: nil)
        }

        throw HelperAPIError.decoding
    }

    func refreshAll(baseURL: String, token: String) async throws -> RefreshAllResponseDTO {
        guard let url = URL(string: baseURL + "/api/helper/refresh-all") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Refresh all failed")
        }

        return try decodeEnvelope(RefreshAllResponseDTO.self, from: data)
    }

    func pair(baseURL: String, code: String) async throws -> PairResponse {
        guard let url = URL(string: baseURL + "/api/system/pair") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(request, policy: .foregroundLiveness)
        } catch let error as URLError where error.code == .timedOut {
            throw HelperAPIError.server(
                "Pairing could not be confirmed. Generate a fresh pairing code on your desktop, then try again."
            )
        }
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }

        guard (200 ... 299).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder().decode(APIEnvelope<PairResponse>.self, from: data),
               let message = envelope.error?.trimmingCharacters(in: .whitespacesAndNewlines),
               !message.isEmpty {
                throw HelperAPIError.server(message)
            }
            throw HelperAPIError.server("Pairing failed")
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

    func listInstallJobs(
        baseURL: String,
        token: String,
        policy: RequestPolicy = .resilient
    ) async throws -> [InstallJobDetailDTO] {
        guard let url = URL(string: baseURL + "/api/helper/jobs") else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request, policy: policy)
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

    func getInstallJob(
        baseURL: String,
        token: String,
        jobId: String,
        policy: RequestPolicy = .resilient
    ) async throws -> InstallJobDetailDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "jobs", jobId]) else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request, policy: policy)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        if http.statusCode == 404 {
            throw HelperAPIError.notFound("This operation is no longer available on the desktop.")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Job request failed")
        }

        return try decodeEnvelope(InstallJobDetailDTO.self, from: data)
    }

    func getInstallJobLogs(
        baseURL: String,
        token: String,
        jobId: String,
        policy: RequestPolicy = .resilient
    ) async throws -> [InstallJobLogDTO] {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "jobs", jobId, "logs"]) else {
            throw HelperAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request, policy: policy)
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

    func submitInstallJob2FA(
        baseURL: String,
        token: String,
        jobId: String,
        code: String,
        expectedRevision: Int,
        expectedUpdatedAt: String
    ) async throws {
        guard let url = helperURL(
            baseURL: baseURL,
            pathComponents: ["api", "helper", "jobs", jobId, "commands", "2fa"]
        ) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode(InstallJobTwoFABody(
            code: code,
            expectedRevision: expectedRevision,
            expectedUpdatedAt: expectedUpdatedAt
        ))

        let (data, response) = try await perform(request, policy: .foregroundLiveness)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            if (400 ... 499).contains(http.statusCode) {
                throw commandRejection(
                    statusCode: http.statusCode,
                    data: data,
                    fallbackMessage: "The host rejected this verification request"
                )
            }
            throw HelperAPIError.server("The host could not confirm this verification request")
        }
        guard let envelope = try? JSONDecoder().decode(HelperCommandErrorEnvelope.self, from: data) else {
            throw HelperAPIError.server("The host response did not confirm this verification request")
        }
        if !envelope.ok {
            throw commandRejection(
                statusCode: http.statusCode,
                data: data,
                fallbackMessage: "The host rejected this verification request"
            )
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
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apps", appId]) else {
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

    func deactivateInstalledApp(baseURL: String, token: String, appId: String) async throws -> InstalledAppDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apps", appId, "deactivate"]) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Deactivate failed")
        }

        return try decodeEnvelope(InstalledAppDTO.self, from: data)
    }

    func reactivateInstalledApp(
        baseURL: String,
        token: String,
        appId: String,
        idempotencyKey: String
    ) async throws -> InstallJobDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apps", appId, "reactivate"]) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Reactivate failed")
        }

        return try decodeEnvelope(InstallJobDTO.self, from: data)
    }

    func listAllDeviceApps(baseURL: String, token: String, deviceUdid: String) async throws -> DeviceAppInventoryDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "devices", deviceUdid, "all-apps"]) else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Device app inventory failed")
        }

        return try decodeEnvelope(DeviceAppInventoryDTO.self, from: data)
    }

    func listLogs(baseURL: String, token: String, level: String? = nil, limit: Int = 200) async throws -> [HelperLogEntryDTO] {
        guard var components = URLComponents(string: baseURL + "/api/helper/logs") else {
            throw HelperAPIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let level, !level.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "level", value: level))
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Logs request failed")
        }

        return try decodeEnvelope([HelperLogEntryDTO].self, from: data)
    }

    func listAppIds(baseURL: String, token: String, sync: Bool = false) async throws -> [HelperAppIdDTO] {
        guard var components = URLComponents(string: baseURL + "/api/helper/app-ids") else {
            throw HelperAPIError.invalidURL
        }
        if sync {
            components.queryItems = [URLQueryItem(name: "sync", value: "true")]
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "App IDs request failed")
        }
        return try decodeEnvelope([HelperAppIdDTO].self, from: data)
    }

    func getAppIdUsage(baseURL: String, token: String) async throws -> [HelperAppIdUsageDTO] {
        guard let url = URL(string: baseURL + "/api/helper/app-ids/usage") else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "App ID usage request failed")
        }
        return try decodeEnvelope([HelperAppIdUsageDTO].self, from: data)
    }

    func deleteAppId(baseURL: String, token: String, appId: String) async throws {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "app-ids", appId]) else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Delete App ID failed")
        }
    }

    func listCertificates(baseURL: String, token: String) async throws -> [HelperCertificateDTO] {
        guard let url = URL(string: baseURL + "/api/helper/certificates") else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Certificates request failed")
        }
        return try decodeEnvelope([HelperCertificateDTO].self, from: data)
    }

    func listTrustedSources(baseURL: String, token: String) async throws -> [TrustedSourceDTO] {
        guard let url = URL(string: baseURL + "/api/helper/trusted-sources") else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Trusted sources request failed")
        }
        return try decodeEnvelope([TrustedSourceDTO].self, from: data)
    }

            func listSources(baseURL: String, token: String) async throws -> [HelperSourceDTO] {
                guard let url = URL(string: baseURL + "/api/helper/sources") else {
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
                    throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Sources request failed")
                }
                return try decodeEnvelope([HelperSourceDTO].self, from: data)
            }

            func addSource(baseURL: String, token: String, urlString: String) async throws {
                guard let url = URL(string: baseURL + "/api/helper/sources") else {
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
                    throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Add source failed")
                }
            }

            func deleteSource(baseURL: String, token: String, sourceId: String) async throws {
                guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "sources", sourceId]) else {
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
                    throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Remove source failed")
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

    func uploadIpa(baseURL: String, token: String, fileName: String, fileData: Data) async throws -> IpaArtifactDTO {
        guard let url = URL(string: baseURL + "/api/helper/ipas/upload") else {
            throw HelperAPIError.invalidURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = makeMultipartBody(boundary: boundary, fileName: fileName, fileData: fileData)

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Upload failed")
        }

        return try decodeEnvelope(IpaArtifactDTO.self, from: data)
    }

    func startInstall(
        baseURL: String,
        token: String,
        ipaId: String,
        accountId: String,
        deviceUdid: String,
        idempotencyKey: String
    ) async throws -> InstallJobDTO {
        guard let url = URL(string: baseURL + "/api/helper/install") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
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
        guard let url = URL(string: SidelinkSourceURLUtil.normalized(urlString)) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("SidelinkHelper/1.0", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw HelperAPIError.server(body?.isEmpty == false ? body! : "Source fetch failed with status \(http.statusCode)")
        }

        do {
            return try JSONDecoder().decode(SourceManifestDTO.self, from: data)
        } catch {
            throw HelperAPIError.server("Source feed could not be read. Make sure it is a valid AltStore source JSON file.")
        }
    }

    func signInAppleAccount(baseURL: String, token: String, appleId: String, password: String) async throws -> HelperAppleAuthPayloadDTO {
        guard let url = URL(string: baseURL + "/api/helper/apple/signin") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode([
            "appleId": appleId,
            "password": password,
        ])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Apple sign-in failed")
        }

        return try decodeEnvelope(HelperAppleAuthPayloadDTO.self, from: data)
    }

    func submitAppleAccount2FA(baseURL: String, token: String, appleId: String, password: String, code: String) async throws -> AccountDTO {
        guard let url = URL(string: baseURL + "/api/helper/apple/2fa") else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode([
            "appleId": appleId,
            "password": password,
            "code": code,
        ])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "2FA verification failed")
        }

        return try decodeEnvelope(AccountDTO.self, from: data)
    }

    func requestAppleSMS(baseURL: String, token: String, appleId: String, phoneId: Int) async throws {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apple", "2fa", "sms"]) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode([
            "appleId": appleId,
            "phoneId": String(phoneId),
        ])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "SMS request failed")
        }
    }

    func reauthenticateAppleAccount(baseURL: String, token: String, accountId: String) async throws -> HelperAppleAuthPayloadDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apple", "accounts", accountId, "reauth"]) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Re-authentication failed")
        }

        return try decodeEnvelope(HelperAppleAuthPayloadDTO.self, from: data)
    }

    func submitAppleAccountReauth2FA(baseURL: String, token: String, accountId: String, code: String) async throws -> AccountDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apple", "accounts", accountId, "reauth", "2fa"]) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode([
            "code": code,
        ])

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw HelperAPIError.server("Invalid response")
        }
        if http.statusCode == 401 {
            throw HelperAPIError.unauthorized
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "2FA verification failed")
        }

        return try decodeEnvelope(AccountDTO.self, from: data)
    }

    func deleteAppleAccount(baseURL: String, token: String, accountId: String) async throws {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "apple", "accounts", accountId]) else {
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
            throw HelperAPIError.server(String(data: data, encoding: .utf8) ?? "Failed to remove Apple ID")
        }
    }

    private func makeMultipartBody(boundary: String, fileName: String, fileData: Data) -> Data {
        var body = Data()
        let safeFileName = fileName.isEmpty ? "Imported.ipa" : fileName

        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"ipa\"; filename=\"\(safeFileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        return body
    }
}
