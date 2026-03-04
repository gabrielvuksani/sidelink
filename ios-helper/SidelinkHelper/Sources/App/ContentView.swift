import SwiftUI

struct ContentView: View {
    @AppStorage("backendURL") private var backendURL = "http://192.168.0.10:4010"
    @AppStorage("helperToken") private var helperToken = ""
    @AppStorage("deviceId") private var deviceId = ""

    @State private var status: HelperStatusResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    TextField("Backend URL", text: $backendURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Helper token", text: $helperToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Optional device ID filter", text: $deviceId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if let status {
                        Label(status.scheduler.running ? "Scheduler running" : "Scheduler paused", systemImage: status.scheduler.running ? "play.fill" : "pause.fill")
                        Text("Refresh threshold: \(Int(status.scheduler.autoRefreshThresholdHours))h")
                        Text("Mode: \(status.mode.uppercased())")
                    }
                }

                if let artifact = status?.helperArtifact {
                    Section("Helper Health") {
                        Label(artifact.available ? "Helper IPA available" : "Helper IPA unavailable", systemImage: artifact.available ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(artifact.available ? .green : .orange)
                        if let message = artifact.message {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let devices = status?.devices {
                    Section("Connectivity") {
                        ForEach(devices) { device in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(device.name).font(.headline)
                                Text("\(device.connection.uppercased()) • \(device.transport.uppercased())")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                if let networkName = device.networkName {
                                    Text(networkName)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if let installs = status?.installs {
                    Section("Installed Apps & Next Refresh") {
                        ForEach(installs) { install in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(install.label)
                                        .font(.headline)
                                    Spacer()
                                    Text(install.health.uppercased())
                                        .font(.caption)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(.thinMaterial)
                                        .clipShape(Capsule())
                                }

                                Text(install.bundleId)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                Text("Expires: \(install.expiresAt)")
                                    .font(.caption)
                                Text("Next auto-attempt: \(install.autoRefresh.nextAttemptAt)")
                                    .font(.caption)
                                Text("Refresh count: \(install.refreshCount)")
                                    .font(.caption)

                                if let reason = install.autoRefresh.lastFailureReason {
                                    Text("Last failure: \(reason)")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }

                                Button("Trigger refresh") {
                                    Task { await triggerRefresh(installId: install.id) }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                            .padding(.vertical, 6)
                        }
                    }
                }

                if let errorMessage {
                    Section("Error") {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Sidelink Helper")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if isLoading {
                        ProgressView()
                    } else {
                        Button("Refresh") {
                            Task { await fetchStatus() }
                        }
                    }
                }
            }
            .task {
                await fetchStatus()
            }
        }
    }

    private func fetchStatus() async {
        guard !backendURL.isEmpty, !helperToken.isEmpty else {
            errorMessage = "Set backend URL and helper token first."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await api.fetchStatus(baseURL: backendURL, token: helperToken, deviceId: deviceId.isEmpty ? nil : deviceId)
            status = response
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func triggerRefresh(installId: String) async {
        guard !backendURL.isEmpty, !helperToken.isEmpty else {
            errorMessage = "Set backend URL and helper token first."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            try await api.triggerRefresh(baseURL: backendURL, token: helperToken, installId: installId)
            await fetchStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
