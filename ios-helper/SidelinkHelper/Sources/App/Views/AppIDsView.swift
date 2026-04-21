import SwiftUI

struct AppIDsView: View {
    @ObservedObject var model: HelperViewModel
    @State private var searchText = ""
    @State private var deleteConfirmation: DestructiveConfirmation?

    private var trackedAccounts: Int {
        Set(model.appIds.compactMap { $0.accountAppleId }.filter { !$0.isEmpty }).count
    }

    private var filteredAppIds: [HelperAppIdDTO] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return model.appIds }
        return model.appIds.filter {
            $0.bundleId.lowercased().contains(query)
            || $0.name.lowercased().contains(query)
            || $0.originalBundleId.lowercased().contains(query)
            || ($0.accountAppleId?.lowercased().contains(query) ?? false)
        }
    }

    var body: some View {
        ZStack {
            SidelinkBackdrop(accent: .slAccent2)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 18) {
                        SidelinkSectionIntro(
                            eyebrow: "Signing",
                            title: "App IDs",
                            subtitle: "Review bundle mappings, slot usage, and cleanup opportunities without the old utility-list feel."
                        )

                        HStack(spacing: 12) {
                            SidelinkMetricTile(label: "Total", value: "\(model.appIds.count)")
                            SidelinkMetricTile(label: "Shown", value: "\(filteredAppIds.count)", tint: .slAccent2)
                            SidelinkMetricTile(label: "Accounts", value: "\(trackedAccounts)", tint: .slWarning)
                        }
                    }
                    .liquidPanel()

                    if !model.appIdUsage.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Usage",
                                title: "Account slot usage",
                                subtitle: "Each Apple ID shows active app slots and this week’s creation budget."
                            )

                            VStack(spacing: 12) {
                                ForEach(model.appIdUsage) { usage in
                                    HStack(spacing: 14) {
                                        SlotGaugeRing(
                                            used: usage.active,
                                            total: usage.maxActive,
                                            size: 52
                                        )

                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(usage.appleId)
                                                .font(.subheadline.bold())
                                            HStack(spacing: 16) {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text("Active Slots")
                                                        .font(.caption2)
                                                        .foregroundStyle(.secondary)
                                                    Text("\(usage.active) / \(usage.maxActive)")
                                                        .font(.caption.bold().monospacedDigit())
                                                }
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text("This Week")
                                                        .font(.caption2)
                                                        .foregroundStyle(.secondary)
                                                    Text("\(usage.weeklyCreated) / \(usage.maxWeekly)")
                                                        .font(.caption.bold().monospacedDigit())
                                                }
                                            }
                                        }
                                        Spacer()
                                    }
                                    .sidelinkInsetPanel()
                                }
                            }
                        }
                        .liquidPanel()
                    }

                    if filteredAppIds.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "app.badge.checkmark")
                                .font(.system(size: 36))
                                .foregroundStyle(.secondary)
                            Text(searchText.isEmpty ? "No App IDs" : "No matching App IDs")
                                .font(.headline)
                            Text(searchText.isEmpty
                                 ? "Install an app and App IDs will appear here automatically."
                                 : "Try a broader search query.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                        .liquidPanel()
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredAppIds) { appId in
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(appId.name)
                                                .font(.subheadline.bold())
                                            Text(appId.bundleId)
                                                .font(.caption.monospaced())
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        PillBadge(
                                            text: appId.originalBundleId == appId.bundleId ? "Original" : "Mapped",
                                            color: appId.originalBundleId == appId.bundleId ? .slSuccess : .slAccent,
                                            small: true
                                        )
                                    }

                                    if appId.originalBundleId != appId.bundleId {
                                        HStack(spacing: 6) {
                                            Image(systemName: "arrow.right")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                            Text(appId.originalBundleId)
                                                .font(.caption2.monospaced())
                                                .foregroundStyle(.secondary)
                                        }
                                    }

                                    HStack(spacing: 14) {
                                        if let appleId = appId.accountAppleId {
                                            Label(appleId, systemImage: "person.circle")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        } else if let teamName = appId.teamName {
                                            Label(teamName, systemImage: "building.2")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Text(SidelinkDateFormatting.relativeDate(appId.createdAt))
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                    }

                                    Button(role: .destructive) {
                                        SidelinkHaptics.impact(.light)
                                        deleteConfirmation = DestructiveConfirmation(
                                            title: "Delete App ID",
                                            message: "Remove \(appId.name) (\(appId.bundleId))? This may free a slot but cannot be undone.",
                                            buttonLabel: "Delete"
                                        ) {
                                            Task { await model.deleteAppId(appId.id) }
                                        }
                                    } label: {
                                        Label("Delete App ID", systemImage: "trash")
                                            .font(.caption.bold())
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(.slDanger)
                                    .controlSize(.small)
                                }
                                .liquidPanel()
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search App IDs")
        .refreshable { await model.loadAppIds(sync: true) }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("App IDs")
                    .font(.headline.weight(.semibold))
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.loadAppIds(sync: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .task { await model.loadAppIds() }
        .alert(
            deleteConfirmation?.title ?? "Confirm",
            isPresented: Binding(
                get: { deleteConfirmation != nil },
                set: { if !$0 { deleteConfirmation = nil } }
            )
        ) {
            Button(deleteConfirmation?.buttonLabel ?? "Delete", role: .destructive) {
                deleteConfirmation?.action()
                deleteConfirmation = nil
            }
            Button("Cancel", role: .cancel) { deleteConfirmation = nil }
        } message: {
            Text(deleteConfirmation?.message ?? "")
        }
    }

}