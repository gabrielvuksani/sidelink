import SwiftUI

struct InstalledTab: View {
    @ObservedObject var model: HelperViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // MARK: - Slot Gauge Ring
                    if let limits = model.config?.freeAccountLimits {
                        HStack(spacing: 20) {
                            SlotGaugeRing(
                                used: model.installedApps.count,
                                total: limits.maxActiveApps,
                                size: 72
                            )
                            .accessibilityLabel("Installed app slots")

                            VStack(alignment: .leading, spacing: 4) {
                                Text("App Slots")
                                    .font(.headline)
                                Text("\(model.installedApps.count) of \(limits.maxActiveApps) active")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                if model.isAtFreeSlotLimit {
                                    PillBadge(text: "Limit Reached", color: .slWarning, small: true)
                                }
                            }
                            Spacer()
                        }
                        .padding()
                        .glassmorphismCard()
                        .padding(.horizontal)
                    }

                    // MARK: - Installed Apps
                    if model.isLoading && model.installedApps.isEmpty {
                        VStack(spacing: 10) {
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                        }
                        .padding(.horizontal)
                    } else if model.installedApps.isEmpty {
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
                            Text("Install an app from the Browse tab and it will appear here with expiry tracking and quick-refresh actions.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(model.installedApps) { install in
                                installedAppCard(install)
                                    .padding(.horizontal)
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
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
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
                healthBadge(for: install.expiresAt)
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

                Button(role: .destructive) {
                    SidelinkHaptics.impact(.light)
                    Task { await model.deleteInstalledApp(install.id) }
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
        guard let expires = ISO8601DateFormatter().date(from: iso) else { return 0 }
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
        guard let expires = ISO8601DateFormatter().date(from: iso) else {
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
        guard let expires = ISO8601DateFormatter().date(from: iso) else { return "unknown" }
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
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}
