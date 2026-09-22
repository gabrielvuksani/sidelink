import Foundation

extension APIClient {
    func fetchDailyOperations(baseURL: String, token: String) async throws -> DailyOperationsSnapshotDTO {
        guard let url = helperURL(baseURL: baseURL, pathComponents: ["api", "helper", "today"]) else {
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
            throw HelperAPIError.server("Daily operations are unavailable")
        }

        return try decodeEnvelope(DailyOperationsSnapshotDTO.self, from: data)
    }

    func cancelInstallJob(
        baseURL: String,
        token: String,
        jobId: String,
        expectedRevision: Int,
        expectedUpdatedAt: String
    ) async throws {
        guard let url = helperURL(
            baseURL: baseURL,
            pathComponents: ["api", "helper", "jobs", jobId, "commands", "cancel"]
        ) else {
            throw HelperAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-sidelink-helper-token")
        request.httpBody = try JSONEncoder().encode(InstallJobCommandVersionBody(
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
                    fallbackMessage: "The host rejected this cancellation request"
                )
            }
            throw HelperAPIError.server("The host could not confirm this cancellation request")
        }

        guard let envelope = try? JSONDecoder().decode(HelperCommandErrorEnvelope.self, from: data) else {
            throw HelperAPIError.server("The host response did not confirm this cancellation request")
        }
        if !envelope.ok {
            throw commandRejection(
                statusCode: http.statusCode,
                data: data,
                fallbackMessage: "The host rejected this cancellation request"
            )
        }
    }
}
