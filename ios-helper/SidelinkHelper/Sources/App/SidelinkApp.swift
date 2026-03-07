import SwiftUI

struct SidelinkAppRootView: View {
    enum RootTab: Hashable {
        case browse
        case search
        case installed
        case sources
        case settings
    }

    @StateObject private var model = HelperViewModel()
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
            SettingsTab(model: model)
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

            guard let sourceURL = components.queryItems?.first(where: { $0.name.lowercased() == "url" })?.value,
                  !sourceURL.isEmpty
            else {
                model.toastMessage = "Invalid source deep link"
                return
            }

            selectedTab = .sources
            pendingSourceImport = PendingSourceImport(url: sourceURL)
        }
        .task {
            await model.refreshAll()
        }
        .tint(.slAccent)
        .fullScreenCover(isPresented: Binding(
            get: { !didCompleteOnboarding },
            set: { value in didCompleteOnboarding = !value }
        )) {
            OnboardingView(model: model, completed: $didCompleteOnboarding)
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
        .sheet(isPresented: $model.installConsolePresented) {
            InstallConsoleSheet(
                model: model
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
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
                        model.dismissInstallConsole()
                        dismiss()
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

private struct ImportSourceSheet: View {
    let sourceURL: String
    let onCancel: () -> Void
    let onImport: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Import Source") {
                    Text("Use this source in SideLink?")
                        .font(.subheadline)
                    Text(sourceURL)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
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
