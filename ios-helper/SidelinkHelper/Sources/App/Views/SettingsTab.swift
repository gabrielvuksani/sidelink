import SwiftUI

struct SettingsTab: View {
    @ObservedObject var model: HelperViewModel
    @AppStorage("backgroundRefreshEnabled") private var backgroundRefreshEnabled = true
    @AppStorage("backgroundRefreshIntervalMinutes") private var backgroundRefreshIntervalMinutes = 30
    @State private var showPairingSheet = false
    @State private var showConnectionSection = true
    @State private var showDiscoverySection = true
    @State private var showLimitsSection = true
    @State private var showSchedulerSection = false
    @State private var showBackgroundRefreshSection = false
    @State private var showAccountDeviceSection = false
    @State private var showDangerSection = false
    @State private var showAboutSection = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    DisclosureGroup("Connection", isExpanded: $showConnectionSection) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                StatusDot(color: model.isPaired ? .slSuccess : .slWarning)
                                Text(model.isPaired ? "Connected" : "Not paired")
                                    .font(.headline)
                                Spacer()
                                if !model.serverVersion.isEmpty {
                                    PillBadge(text: "v\(model.serverVersion)", color: .slMuted, small: true)
                                }
                            }
                            TextField("Backend URL", text: $model.backendURL)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .textFieldStyle(.roundedBorder)
                            TextField("Optional Device UDID filter", text: $model.deviceId)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .textFieldStyle(.roundedBorder)
                                .font(.caption)
                            if !model.serverName.isEmpty {
                                HStack {
                                    Label("Server", systemImage: "desktopcomputer")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Text(model.serverName)
                                        .font(.caption)
                                }
                            }

                            Button {
                                showPairingSheet = true
                            } label: {
                                Label(model.isPaired ? "Re-pair Helper" : "Enter Pairing Code", systemImage: "key.horizontal")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.slAccent)
                        }
                        .padding(.top, 8)
                    }
                    .glassmorphismCard()
                    .padding(.horizontal)

                    DisclosureGroup("Discovered on LAN", isExpanded: $showDiscoverySection) {
                        VStack(alignment: .leading, spacing: 10) {
                            if model.discoveredBackends.isEmpty {
                                HStack(spacing: 10) {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("Scanning local network...")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            } else {
                                ForEach(model.discoveredBackends) { backend in
                                    Button {
                                        SidelinkHaptics.selection()
                                        model.applyDiscoveredBackend(backend)
                                    } label: {
                                        HStack {
                                            Image(systemName: "desktopcomputer")
                                                .foregroundStyle(Color.slAccent)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(backend.name).font(.subheadline.bold())
                                                Text(backend.url)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }
                                            Spacer()
                                            Image(systemName: "arrow.right.circle")
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.top, 8)
                    }
                    .sidelinkCard()
                    .padding(.horizontal)

                    // MARK: - Limit Gauges
                    if let limits = model.config?.freeAccountLimits {
                        DisclosureGroup("Free Account Limits", isExpanded: $showLimitsSection) {
                            VStack(alignment: .leading, spacing: 14) {
                                HStack(spacing: 20) {
                                    VStack(spacing: 4) {
                                        SlotGaugeRing(
                                            used: model.activeAppSlotUsage,
                                            total: limits.maxActiveApps,
                                            size: 60
                                        )
                                        .accessibilityLabel("Active app slots")
                                        Text("Slots")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("App IDs / week")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                        LinearGaugeBar(
                                            fraction: Double(weeklyIdsUsed) / Double(limits.maxNewAppIdsPerWeek),
                                            height: 6
                                        )
                                        Text("\(weeklyIdsUsed) / \(limits.maxNewAppIdsPerWeek)")
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Cert validity")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    LinearGaugeBar(
                                        fraction: Double(limits.certValidityDays) / 365.0,
                                        height: 6
                                    )
                                    Text("\(limits.certValidityDays) days")
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.top, 8)
                        }
                        .sidelinkCard()
                        .padding(.horizontal)
                    }

                    // MARK: - Scheduler
                    DisclosureGroup("Scheduler", isExpanded: $showSchedulerSection) {
                        HStack {
                            Label(
                                model.config?.schedulerEnabled == true ? "Enabled" : "Disabled",
                                systemImage: model.config?.schedulerEnabled == true ? "play.fill" : "pause.fill"
                            )
                            .foregroundStyle(model.config?.schedulerEnabled == true ? Color.slSuccess : .secondary)
                            Spacer()
                            if let interval = model.config?.schedulerCheckIntervalMs {
                                Text("\(interval / 60_000) min interval")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 8)
                    }
                    .sidelinkCard()
                    .padding(.horizontal)

                    // MARK: - Background Refresh with Slider
                    DisclosureGroup("Background Refresh", isExpanded: $showBackgroundRefreshSection) {
                        Toggle(isOn: $backgroundRefreshEnabled) {
                            Label("Enable background refresh", systemImage: "arrow.triangle.2.circlepath")
                                .font(.subheadline)
                        }
                        .onChange(of: backgroundRefreshEnabled) { enabled in
                            if enabled {
                                Task {
                                    await BackgroundRefreshCoordinator.shared.requestNotificationAuthorizationIfNeeded()
                                    BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(true)
                                }
                            } else {
                                BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(false)
                            }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Interval: \(backgroundRefreshIntervalMinutes) min")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Slider(
                                value: Binding(
                                    get: { Double(backgroundRefreshIntervalMinutes) },
                                    set: { backgroundRefreshIntervalMinutes = Int($0) }
                                ),
                                in: 15...180,
                                step: 15
                            )
                            .tint(.slAccent)
                        }
                        .padding(.top, 4)
                        .onChange(of: backgroundRefreshIntervalMinutes) { _ in
                            guard backgroundRefreshEnabled else { return }
                            BackgroundRefreshCoordinator.shared.scheduleAppRefresh()
                        }
                    }
                    .sidelinkCard()
                    .padding(.horizontal)

                    // MARK: - Account & Device
                    DisclosureGroup("Account & Device", isExpanded: $showAccountDeviceSection) {
                        VStack(alignment: .leading, spacing: 10) {
                            if let selected = model.accounts.first(where: { $0.id == model.selectedAccountId }) {
                                HStack(spacing: 12) {
                                    Image(systemName: "person.crop.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(Color.slAccent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(selected.appleId).font(.subheadline)
                                        Text("\(selected.teamName) · \(selected.accountType.capitalized)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }

                            if let selected = model.devices.first(where: { $0.id == model.selectedDeviceUdid }) {
                                HStack(spacing: 12) {
                                    Image(systemName: "iphone")
                                        .font(.title2)
                                        .foregroundStyle(Color.slAccent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(selected.name).font(.subheadline)
                                        Text("\(selected.id) · \(selected.connection.capitalized)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                        .padding(.top, 8)
                    }
                    .sidelinkCard()
                    .padding(.horizontal)

                    // MARK: - Danger Zone (red)
                    DisclosureGroup("Danger Zone", isExpanded: $showDangerSection) {
                        VStack(spacing: 12) {
                            Button(role: .destructive) {
                                SidelinkHaptics.impact(.light)
                                model.clearPairing()
                            } label: {
                                Label("Clear Pairing", systemImage: "link.badge.plus")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .tint(.slDanger)

                            Button {
                                Task { await model.refreshAll() }
                            } label: {
                                Label("Reload Data", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(model.isLoading || !model.isPaired)
                        }
                        .padding(.top, 8)
                    }
                    .tint(.slDanger)
                    .sidelinkCard()
                    .padding(.horizontal)

                    // MARK: - About
                    DisclosureGroup("About", isExpanded: $showAboutSection) {
                        VStack(spacing: 6) {
                            aboutRow("App", "Sidelink Helper")
                            aboutRow("Version", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                            aboutRow("Build", Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
                            aboutRow("Platform", UIDevice.current.systemName + " " + UIDevice.current.systemVersion)
                        }
                        .padding(.top, 8)
                    }
                    .sidelinkCard()
                    .padding(.horizontal)

                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                            .padding(.horizontal)
                    }

                    Spacer(minLength: 20)
                }
                .padding(.vertical)
            }
            .refreshable {
                await model.refreshAll()
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showPairingSheet) {
                PairingSheet(model: model)
            }
        }
    }

    private var weeklyIdsUsed: Int {
        guard let usage = model.config?.freeAccountUsage else { return 0 }
        // Sum weekly IDs across all accounts from the usage dictionary
        if let dict = usage.weeklyAppIdsUsedByAccount {
            return dict.values.reduce(0, +)
        }
        return 0
    }

    private func aboutRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
        }
    }
}

private struct PairingSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Enter the 6-digit pairing code from the desktop app.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    PairingCodeEntryView(code: $model.pairingCode, onSubmit: {
                        Task {
                            await model.pair()
                            if model.isPaired {
                                dismiss()
                            }
                        }
                    }, isLoading: model.isLoading, autoFocus: false)

                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Pair Helper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
