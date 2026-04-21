import SwiftUI

struct SidelinkAppRootView: View {
    @Environment(\.scenePhase) private var scenePhase

    enum RootTab: Hashable {
        case browse
        case search
        case installed
        case sources
        case settings
    }

    @StateObject private var model = HelperViewModel()
    @StateObject private var permissions = PermissionCoordinator.shared
    @AppStorage("didCompleteOnboarding") private var didCompleteOnboarding = false
    @State private var selectedTab: RootTab = .browse
    @State private var pendingSourceImport: PendingSourceImport?

    var body: some View {
        TabView(selection: $selectedTab) {
            BrowseTab(model: model)
                .tag(RootTab.browse)
                .tabItem { Label("Home", systemImage: "sparkles") }
            SearchTab(model: model)
                .tag(RootTab.search)
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SourcesTab(model: model)
                .tag(RootTab.sources)
                .tabItem { Label("Sources", systemImage: "square.stack.3d.up") }
            InstalledTab(model: model)
                .tag(RootTab.installed)
                .tabItem { Label("Installed", systemImage: "checkmark.shield") }
                .badge(model.installedAttentionCount)
            SettingsTab(model: model, permissions: permissions)
                .tag(RootTab.settings)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .badge(model.settingsAttentionCount)
        }
        .onOpenURL { incomingURL in
            guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false) else {
                return
            }

            let normalizedScheme = (components.scheme ?? "").lowercased()
            let normalizedHost = (components.host ?? "").lowercased()
            guard normalizedScheme == "sidelink" && normalizedHost == "source" else {
                return
            }

            guard let rawSourceURL = components.queryItems?.first(where: { $0.name.lowercased() == "url" })?.value,
                  !rawSourceURL.isEmpty
            else {
                model.toastMessage = "Invalid source deep link"
                return
            }

            // Deep-link-delivered source URLs are attacker-influenced (any Safari
            // page can redirect into sidelink://source?url=…). Require https,
            // strip percent-encoded control characters, and reject private
            // network hosts so a tap in Safari can't silently import a manifest
            // from an LAN attacker's unsigned server.
            guard let sanitizedURL = sanitizeDeepLinkSourceURL(rawSourceURL) else {
                model.toastMessage = "That source URL isn't safe to import."
                return
            }

            selectedTab = .sources
            pendingSourceImport = PendingSourceImport(url: sanitizedURL)
        }
        .task {
            await model.refreshAll()
            await permissions.refreshStatuses()
            // Only auto-request all permissions when onboarding is done.
            // During onboarding, the onboarding flow handles permission
            // requests step-by-step to avoid queuing multiple dialogs.
            if didCompleteOnboarding {
                await permissions.requestAllIfNeeded()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await model.refreshAllSilently()
                    await permissions.refreshStatuses()
                    if didCompleteOnboarding {
                        permissions.requestLocalNetworkIfNeeded(force: true)
                    }
                }
            }
        }
        .onDisappear {
            // Deterministically cancel long-lived tasks (install polling, SSE
            // reconnect timers) so the view model actually tears down instead
            // of leaving the @MainActor-isolated state for `deinit` to touch.
            model.invalidate()
        }
        .tint(.slAccent)
        .fullScreenCover(isPresented: Binding(
            get: { !didCompleteOnboarding },
            set: { value in didCompleteOnboarding = !value }
        )) {
            OnboardingView(model: model, permissions: permissions, completed: $didCompleteOnboarding)
        }
        .sheet(item: $pendingSourceImport) { pending in
            ImportSourceSheet(
                sourceURL: pending.url,
                onCancel: { pendingSourceImport = nil },
                onImport: {
                    Task {
                        await model.addSourceFromDeepLink(pending.url)
                        pendingSourceImport = nil
                    }
                }
            )
        }
        .sheet(isPresented: Binding(
            get: { model.installConsolePresented },
            set: { presented in
                if presented {
                    model.openInstallConsole()
                } else {
                    model.handleInstallConsoleDismissAttempt()
                }
            }
        )) {
            InstallConsoleSheet(
                model: model
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .interactiveDismissDisabled(model.installConsoleRequiresPersistentPresentation)
        }
        .alert("Message", isPresented: Binding(
            get: { model.toastMessage != nil },
            set: { _ in model.toastMessage = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.toastMessage ?? "")
        }
    }
}

private struct InstallConsoleSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        heroCard

                        if let error = model.errorMessage {
                            issueCard(title: "Install blocked", message: error, tint: .slDanger, systemImage: "xmark.octagon.fill")
                        }

                        if let readiness = model.installReadinessMessage,
                           model.activeInstallJob == nil,
                           !model.isLoading,
                           model.errorMessage == nil {
                            issueCard(title: "Before you install", message: readiness, tint: .slWarning, systemImage: "info.circle.fill")
                        }

                        if model.isLoading && model.activeInstallJob == nil {
                            preparingCard
                        }

                        if let job = model.activeInstallJob {
                            InstallProgressView(
                                job: job,
                                logs: model.activeInstallLogs,
                                twoFACode: $model.activeInstall2FACode,
                                onSubmitTwoFA: {
                                    Task { await model.submitActiveInstall2FA() }
                                },
                                onRetry: {
                                    Task { await model.retryLastInstallRequest() }
                                },
                                isSubmitting: model.isLoading,
                                showsVerboseLogs: false
                            )
                        } else if !model.isLoading && model.errorMessage == nil {
                            idleCard
                        }

                        actionBar
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
                }
            }
            .navigationTitle("Install Console")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        model.requestInstallConsoleClose()
                    }
                }
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Live installation")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(model.installConsoleResolvedTitle)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text(model.installConsoleResolvedSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                statusChip
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Progress")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ProgressView(value: model.activeInstallProgressFraction)
                    .tint(.slAccent)
                if model.activeInstallJob != nil {
                    InstallVerboseLogConsole(logs: model.activeInstallLogs, maxHeight: 168)
                }
            }
        }
        .liquidPanel()
    }

    private var preparingCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Preparing secure install", systemImage: "hourglass.and.lock")
                .font(.headline)
            Text(model.installPreparationSummary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ProgressView()
                .tint(.slAccent)
        }
        .liquidPanel()
    }

    private var idleCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("No active install", systemImage: "checkmark.circle")
                .font(.headline)
            Text("Start an install from a source page or your library and the full signing workflow will stay here until it finishes.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .liquidPanel()
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            if model.errorMessage != nil || model.activeInstallJob?.status == "failed" {
                Button {
                    Task { await model.retryLastInstallRequest() }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.sidelinkQuickAction)
            }
        }
    }

    private var statusChip: some View {
        Text(statusText)
            .font(.caption.weight(.semibold))
            .foregroundStyle(statusColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(statusColor.opacity(0.12), in: Capsule())
    }

    private var statusText: String {
        if let job = model.activeInstallJob {
            return job.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
        if model.isLoading {
            return "Preparing"
        }
        if model.errorMessage != nil {
            return "Blocked"
        }
        return "Ready"
    }

    private var statusColor: Color {
        if let job = model.activeInstallJob {
            switch job.status {
            case "completed": return .green
            case "failed": return .red
            case "waiting_2fa": return .orange
            case "running": return .blue
            default: return .slAccent
            }
        }
        if model.errorMessage != nil {
            return .red
        }
        return .slAccent
    }

    private func issueCard(title: String, message: String, tint: Color, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .liquidPanel()
    }
}

private struct PendingSourceImport: Identifiable {
    let id = UUID()
    let url: String
}

/// Returns a validated https URL string or nil if the deep-link payload is
/// unsafe. Rejects non-https schemes, control-character injections, private
/// network hosts, and embedded credentials. Normalises the string by dropping
/// userinfo and re-serialising via URLComponents so downstream code can trust
/// the scheme+host parse.
private func sanitizeDeepLinkSourceURL(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return nil }

    // Reject control characters that could hide the real destination in
    // the confirmation UI (e.g. bidi marks, NULs, backspace).
    for scalar in trimmed.unicodeScalars {
        let value = scalar.value
        if value < 0x20 || value == 0x7F || (0x200B...0x200F).contains(value) || (0x202A...0x202E).contains(value) || (0x2066...0x2069).contains(value) {
            return nil
        }
    }

    guard var components = URLComponents(string: trimmed) else { return nil }
    guard let scheme = components.scheme?.lowercased(), scheme == "https" else { return nil }
    guard let host = components.host, !host.isEmpty else { return nil }
    if components.user != nil || components.password != nil { return nil }

    // Block common private / loopback address literals. Name resolution to a
    // private IP is still caught server-side by the SSRF guard.
    let lowerHost = host.lowercased()
    if lowerHost == "localhost" || lowerHost.hasSuffix(".local") || lowerHost == "::1" || lowerHost.hasPrefix("127.") {
        return nil
    }
    let octets = lowerHost.split(separator: ".").compactMap { UInt8($0) }
    if octets.count == 4 {
        let a = octets[0], b = octets[1]
        if a == 10 { return nil }
        if a == 192 && b == 168 { return nil }
        if a == 172 && (16...31).contains(b) { return nil }
        if a == 169 && b == 254 { return nil }
    }

    components.user = nil
    components.password = nil
    components.fragment = nil
    return components.url?.absoluteString
}

private struct ImportSourceSheet: View {
    let sourceURL: String
    let onCancel: () -> Void
    let onImport: () -> Void

    private var originDisplay: String {
        if let parsed = URL(string: sourceURL), let host = parsed.host {
            if let port = parsed.port {
                return "\(parsed.scheme ?? "https")://\(host):\(port)"
            }
            return "\(parsed.scheme ?? "https")://\(host)"
        }
        return sourceURL
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Import source from")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(originDisplay)
                        .font(.title3.weight(.bold))
                        .textSelection(.enabled)
                    Text(sourceURL)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Confirm import")
                } footer: {
                    Text("This source was delivered by a link. Verify the origin matches a site you trust before continuing.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button {
                        onImport()
                    } label: {
                        Label("Import Source", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .navigationTitle("Import Source")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
