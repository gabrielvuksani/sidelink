import SwiftUI
import UniformTypeIdentifiers

struct InstalledTab: View {
    @ObservedObject var model: HelperViewModel
    @State private var deleteConfirmation: DestructiveConfirmation?
    @State private var showImportOptions = false
    @State private var showImportURLSheet = false
    @State private var showFileImporter = false

    private var activeApps: [InstalledAppDTO] {
        model.installedApps.filter { ($0.status ?? "active") != "deactivated" }
    }

    private var deactivatedApps: [InstalledAppDTO] {
        model.installedApps.filter { ($0.status ?? "active") == "deactivated" }
    }

    private var weeklyIdsUsed: Int {
        model.config?.freeAccountUsage?.weeklyAppIdsUsedByAccount?.values.reduce(0, +) ?? 0
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let activeJob = model.activeInstallJob {
                        InstallProgressView(
                            job: activeJob,
                            logs: model.activeInstallLogs,
                            twoFACode: $model.activeInstall2FACode,
                            onSubmitTwoFA: {
                                Task { await model.submitActiveInstall2FA() }
                            },
                            onRetry: {
                                if let job = model.activeInstallJob {
                                    Task { await model.startInstall(ipaId: job.ipaId) }
                                }
                            },
                            isSubmitting: model.isLoading
                        )
                        .padding(.horizontal)
                    }

                    if let limits = model.config?.freeAccountLimits {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack(spacing: 20) {
                                SlotGaugeRing(
                                    used: activeApps.count,
                                    total: limits.maxActiveApps,
                                    size: 72
                                )
                                .accessibilityLabel("Installed app slots")

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Signing Status")
                                        .font(.headline)
                                    Text("\(activeApps.count) of \(limits.maxActiveApps) active slots in use")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    if model.isAtFreeSlotLimit {
                                        PillBadge(text: "Limit Reached", color: .slWarning, small: true)
                                    }
                                }
                                Spacer()
                            }

                            VStack(alignment: .leading, spacing: 8) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Weekly App IDs")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    LinearGaugeBar(
                                        fraction: min(1, Double(weeklyIdsUsed) / Double(max(limits.maxNewAppIdsPerWeek, 1))),
                                        height: 6
                                    )
                                    Text("\(weeklyIdsUsed) / \(limits.maxNewAppIdsPerWeek)")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }

                                Text("Certificates last \(limits.certValidityDays) days on free accounts.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding()
                        .glassmorphismCard()
                        .padding(.horizontal)
                    }

                    HStack(spacing: 12) {
                        Button {
                            Task { await model.refreshAllApps() }
                        } label: {
                            Label("Refresh All", systemImage: "arrow.triangle.2.circlepath.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.isPaired || activeApps.isEmpty || model.isLoading)

                        if !model.unmanagedInstalledApps.isEmpty {
                            PillBadge(text: "\(model.unmanagedInstalledApps.count) unmanaged", color: .slWarning)
                        }
                    }
                    .padding(.horizontal)

                    // MARK: - Installed Apps
                    if model.isLoading && model.installedApps.isEmpty {
                        VStack(spacing: 10) {
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                        }
                        .padding(.horizontal)
                    } else if model.installedApps.isEmpty && model.unmanagedInstalledApps.isEmpty {
                        // Empty state illustration
                        VStack(spacing: 16) {
                            ZStack {
                                Circle()
                                    .fill(.secondary.opacity(0.08))
                                    .frame(width: 120, height: 120)
                                Image(systemName: "checkmark.shield.fill")
                                    .font(.system(size: 48))
                                    .foregroundStyle(.secondary.opacity(0.4))
                            }
                            Text("No installed apps")
                                .font(.title3.bold())
                                .foregroundStyle(.secondary)
                            Text("Import an IPA with the plus button, or install from Home, Search, or Sources. Signed apps will appear here with expiry tracking and refresh actions.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else if !activeApps.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Active Installs")
                                .sectionHeader()
                                .padding(.horizontal)

                            LazyVStack(spacing: 12) {
                                ForEach(activeApps) { install in
                                    installedAppCard(install)
                                        .padding(.horizontal)
                                }
                            }
                        }
                    }

                    if !deactivatedApps.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Deactivated")
                                .sectionHeader()
                                .padding(.horizontal)

                            LazyVStack(spacing: 12) {
                                ForEach(deactivatedApps) { install in
                                    installedAppCard(install)
                                        .padding(.horizontal)
                                }
                            }
                        }
                    }

                    if !model.unmanagedInstalledApps.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(activeApps.isEmpty ? "Installed On Device" : "Other Apps On Device")
                                .sectionHeader()
                                .padding(.horizontal)

                            LazyVStack(spacing: 10) {
                                ForEach(model.unmanagedInstalledApps) { app in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(app.name)
                                                .font(.subheadline.bold())
                                            Text(app.bundleId)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        PillBadge(text: activeApps.isEmpty ? "Installed" : "External", color: .slMuted, small: true)
                                    }
                                    .sidelinkCard()
                                    .padding(.horizontal)
                                }
                            }
                        }
                    }



                    VStack(alignment: .leading, spacing: 12) {
                        Text("Library")
                            .sectionHeader()
                            .padding(.horizontal)

                        if model.ipas.isEmpty {
                            Text("Imported IPAs and uploaded files live here once you add them from the plus button.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal)
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(model.ipas) { ipa in
                                    NavigationLink {
                                        AppDetailView(model: model, ipa: ipa)
                                    } label: {
                                        libraryRow(ipa)
                                    }
                                    .buttonStyle(.plain)
                                    .padding(.horizontal)
                                }
                            }
                        }
                    }
                }
                .padding(.vertical)
            }
            .refreshable {
                await model.refreshAll()
            }
            .navigationTitle("Installed")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showImportOptions = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .onChange(of: model.selectedDeviceUdid) { _ in
                Task { await model.refreshAll() }
            }
            .alert(
                deleteConfirmation?.title ?? "Confirm",
                isPresented: Binding(
                    get: { deleteConfirmation != nil },
                    set: { if !$0 { deleteConfirmation = nil } }
                )
            ) {
                Button(deleteConfirmation?.buttonLabel ?? "Remove", role: .destructive) {
                    deleteConfirmation?.action()
                    deleteConfirmation = nil
                }
                Button("Cancel", role: .cancel) { deleteConfirmation = nil }
            } message: {
                Text(deleteConfirmation?.message ?? "")
            }
            .confirmationDialog("Import App", isPresented: $showImportOptions, titleVisibility: .visible) {
                Button("Import from URL") {
                    showImportURLSheet = true
                }
                Button("Upload from Files") {
                    showFileImporter = true
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Add an IPA from a remote URL or pick one from Files.")
            }
            .sheet(isPresented: $showImportURLSheet) {
                InstalledImportURLSheet(model: model)
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [UTType(filenameExtension: "ipa") ?? .data],
                allowsMultipleSelection: false
            ) { result in
                handleImportSelection(result)
            }
        }
    }

    private func handleImportSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task {
                let didAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if didAccess {
                        url.stopAccessingSecurityScopedResource()
                    }
                }

                do {
                    let fileName = url.lastPathComponent
                    let data = try await Task.detached(priority: .userInitiated) {
                        try Data(contentsOf: url, options: [.mappedIfSafe])
                    }.value
                    await model.importLocalIpa(fileName: fileName, fileData: data)
                } catch {
                    model.errorMessage = error.localizedDescription
                }
            }
        case .failure(let error):
            model.errorMessage = error.localizedDescription
        }
    }

    // MARK: - App Card with Expiry Progress
    private func installedAppCard(_ install: InstalledAppDTO) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(install.appName ?? install.originalBundleId)
                        .font(.headline)
                    if let version = install.appVersion, !version.isEmpty {
                        Text("v\(version)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    healthBadge(for: install.expiresAt)
                    if (install.status ?? "active") == "deactivated" {
                        PillBadge(text: "Deactivated", color: .slWarning, small: true)
                    }
                }
            }

            Text(install.bundleId)
                .font(.caption)
                .foregroundStyle(.secondary)

            // Expiry progress bar
            VStack(alignment: .leading, spacing: 4) {
                LinearGaugeBar(fraction: expiryFraction(for: install.expiresAt), height: 6)

                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text(countdownText(for: install.expiresAt))
                        .font(.caption)
                }
                .foregroundStyle(healthColor(for: install.expiresAt))
            }

            HStack(spacing: 16) {
                if let lastRefresh = install.lastRefreshAt {
                    Label(relativeDate(lastRefresh), systemImage: "arrow.clockwise")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Label("\(install.refreshCount)×", systemImage: "repeat")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                if (install.status ?? "active") == "deactivated" {
                    Button {
                        SidelinkHaptics.impact()
                        Task { await model.reactivateInstalledApp(install.id) }
                    } label: {
                        Label("Reactivate", systemImage: "bolt.badge.a")
                            .font(.caption.bold())
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(.slAccent)
                } else {
                    Button {
                        SidelinkHaptics.impact()
                        Task { await model.triggerRefresh(installId: install.id) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption.bold())
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(.slAccent)
                    .accessibilityLabel("Refresh app signing")

                    Button {
                        SidelinkHaptics.impact(.light)
                        Task { await model.deactivateInstalledApp(install.id) }
                    } label: {
                        Label("Deactivate", systemImage: "pause.circle")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                Button(role: .destructive) {
                    SidelinkHaptics.impact(.light)
                    deleteConfirmation = DestructiveConfirmation(
                        title: "Remove App",
                        message: "Remove \(install.appName ?? install.originalBundleId) from your installed apps? This cannot be undone.",
                        buttonLabel: "Remove"
                    ) {
                        Task { await model.deleteInstalledApp(install.id) }
                    }
                } label: {
                    Label("Remove", systemImage: "trash")
                        .font(.caption.bold())
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .sidelinkCard()
    }

    // MARK: - Helpers
    private func expiryFraction(for iso: String) -> Double {
        guard let expires = SidelinkDateFormatting.parse(iso) else { return 0 }
        let totalDays: Double = 7
        let remaining = expires.timeIntervalSinceNow / 86_400
        if remaining <= 0 { return 1.0 }
        return max(0, 1.0 - (remaining / totalDays))
    }

    @ViewBuilder
    private func healthBadge(for iso: String) -> some View {
        let label = healthLabel(for: iso)
        let color = healthColor(for: iso)
        let icon = healthIcon(for: iso)

        Label(label.uppercased(), systemImage: icon)
            .font(.caption2.bold())
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func countdownText(for iso: String) -> String {
        guard let expires = SidelinkDateFormatting.parse(iso) else {
            return "Unknown"
        }
        let remaining = expires.timeIntervalSinceNow
        if remaining <= 0 {
            return "Expired"
        }
        let totalHours = Int(remaining / 3600)
        let days = totalHours / 24
        let hours = totalHours % 24
        if days > 0 {
            return "Expires in \(days)d \(hours)h"
        }
        let minutes = max(1, Int(remaining / 60))
        if totalHours > 0 {
            return "Expires in \(totalHours)h \(minutes % 60)m"
        }
        return "Expires in \(minutes)m"
    }

    private func healthLabel(for iso: String) -> String {
        guard let expires = SidelinkDateFormatting.parse(iso) else { return "unknown" }
        let remainingDays = expires.timeIntervalSinceNow / 86_400
        if remainingDays <= 0 { return "expired" }
        if remainingDays < 1 { return "critical" }
        if remainingDays <= 3 { return "expiring" }
        return "healthy"
    }

    private func healthIcon(for iso: String) -> String {
        switch healthLabel(for: iso) {
        case "healthy": return "checkmark.seal.fill"
        case "expiring": return "exclamationmark.triangle"
        case "critical": return "flame.fill"
        default: return "xmark.seal"
        }
    }

    private func healthColor(for iso: String) -> Color {
        switch healthLabel(for: iso) {
        case "healthy": return .slSuccess
        case "expiring": return .slWarning
        case "critical": return .slDanger
        default: return .slMuted
        }
    }

    private func relativeDate(_ iso: String) -> String {
        SidelinkDateFormatting.relativeDate(iso)
    }

    private func libraryRow(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 12) {
            if let iconData = ipa.iconData,
               let data = Data(base64Encoded: iconData),
               let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .appIconStyle(size: 44)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.secondary.opacity(0.12))
                    .frame(width: 44, height: 44)
                    .overlay {
                        Image(systemName: "app.fill")
                            .foregroundStyle(.secondary)
                    }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(ipa.bundleName)
                    .font(.subheadline.bold())
                Text("\(ipa.bundleId) · v\(ipa.bundleShortVersion)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if model.installedApps.contains(where: { $0.bundleId == ipa.bundleId || $0.originalBundleId == ipa.bundleId }) {
                PillBadge(text: "Installed", color: .slSuccess, small: true)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary.opacity(0.5))
        }
        .padding(.vertical, 10)
    }
}

private struct InstalledImportURLSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Import IPA from URL") {
                    TextField("https://example.com/app.ipa", text: $model.importURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)

                    Text("Paste a direct IPA download link. Sidelink will import it into your library before you sign it.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        Task {
                            await model.importFromURL()
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    } label: {
                        Label("Import IPA", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.importURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isLoading)
                }
            }
            .navigationTitle("Import App")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
