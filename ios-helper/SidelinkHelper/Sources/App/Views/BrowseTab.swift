import SwiftUI

struct BrowseTab: View {
    @ObservedObject var model: HelperViewModel
    @State private var query = ""
    @State private var showImportSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // MARK: - Toolbar Pickers + Slot Badge
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) {
                            Picker("Account", selection: $model.selectedAccountId) {
                                ForEach(model.accounts) { account in
                                    Text(account.appleId).tag(account.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .lineLimit(1)

                            Picker("Device", selection: $model.selectedDeviceUdid) {
                                ForEach(model.devices) { device in
                                    Text(device.name).tag(device.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .lineLimit(1)

                            Spacer()

                            PillBadge(
                                text: "\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots) slots",
                                color: model.isAtFreeSlotLimit ? .slWarning : .slAccent
                            )
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Account", selection: $model.selectedAccountId) {
                                ForEach(model.accounts) { account in
                                    Text(account.appleId).tag(account.id)
                                }
                            }
                            .pickerStyle(.menu)

                            Picker("Device", selection: $model.selectedDeviceUdid) {
                                ForEach(model.devices) { device in
                                    Text(device.name).tag(device.id)
                                }
                            }
                            .pickerStyle(.menu)

                            PillBadge(
                                text: "\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots) slots",
                                color: model.isAtFreeSlotLimit ? .slWarning : .slAccent
                            )
                        }
                    }
                    .padding(.horizontal)

                    // MARK: - Featured Hero Card
                    if let featured = model.ipas.first {
                        NavigationLink {
                            AppDetailView(model: model, ipa: featured)
                        } label: {
                            ZStack(alignment: .bottomLeading) {
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .fill(
                                        LinearGradient(
                                            colors: [.slAccent, .slAccent2],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(height: 180)

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("FEATURED")
                                        .font(.caption2.bold())
                                        .foregroundStyle(.white.opacity(0.7))
                                    Text(featured.bundleName)
                                        .font(.title2.bold())
                                        .foregroundStyle(.white)
                                    Text("v\(featured.bundleShortVersion) · \(featured.bundleId)")
                                        .font(.caption)
                                        .foregroundStyle(.white.opacity(0.8))
                                }
                                .padding(20)
                            }
                            .heroCard(tint: .slAccent)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal)
                    }

                    // MARK: - Active Install Progress
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
                        .sidelinkCard()
                        .padding(.horizontal)
                    }

                    // MARK: - Source Apps Horizontal Section
                    if model.isLoading && model.sourceCatalogs.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("From Sources")
                                .sectionHeader()
                                .padding(.horizontal)

                            VStack(spacing: 8) {
                                SkeletonRow(lineCount: 2)
                                SkeletonRow(lineCount: 2)
                            }
                            .padding(.horizontal)
                        }
                    } else if !sourceApps.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("From Sources")
                                .sectionHeader()
                                .padding(.horizontal)

                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 14) {
                                    ForEach(sourceApps.prefix(20)) { app in
                                        sourceAppCard(app)
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }

                    // MARK: - Library Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Library")
                            .sectionHeader()
                            .padding(.horizontal)

                        if model.isLoading && model.ipas.isEmpty {
                            VStack(spacing: 10) {
                                SkeletonRow(lineCount: 2)
                                SkeletonRow(lineCount: 2)
                                SkeletonRow(lineCount: 2)
                            }
                            .padding(.horizontal)
                        } else if filteredIpas.isEmpty {
                            if model.ipas.isEmpty {
                                VStack(spacing: 12) {
                                    Image(systemName: "shippingbox")
                                        .font(.system(size: 48))
                                        .foregroundStyle(.secondary.opacity(0.5))
                                    Text("No apps yet")
                                        .font(.headline)
                                        .foregroundStyle(.secondary)
                                    Text("Upload IPAs from your desktop, import one by URL, or add a source to discover apps.")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 32)
                                .padding(.horizontal)
                            } else {
                                Text("No apps matching \"\(query)\"")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal)
                            }
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(filteredIpas) { ipa in
                                    NavigationLink {
                                        AppDetailView(model: model, ipa: ipa)
                                    } label: {
                                        ipaRow(ipa)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .padding(.vertical)
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search apps")
            .refreshable {
                await model.refreshAll()
            }
            .navigationTitle("Browse")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showImportSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showImportSheet) {
                importSheet
            }
        }
    }

    // MARK: - Import Sheet
    private var importSheet: some View {
        NavigationStack {
            Form {
                Section("Import IPA from URL") {
                    TextField("https://example.com/app.ipa", text: $model.importURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Button {
                        Task {
                            await model.importFromURL()
                            showImportSheet = false
                        }
                    } label: {
                        Label("Import", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.importURL.isEmpty || !model.isPaired || model.isLoading)
                }
            }
            .navigationTitle("Import IPA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showImportSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Source App Card (horizontal scroll)
    private func sourceAppCard(_ app: SourceAppDTO) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SidelinkAsyncImage(url: app.iconURL, size: 56)

            Text(app.name)
                .font(.caption.bold())
                .lineLimit(1)
            if let dev = app.developerName {
                Text(dev)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Button {
                SidelinkHaptics.impact()
                Task { await model.installFromSource(app) }
            } label: {
                Text("GET")
                    .font(.caption2.bold())
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.mini)
            .tint(.slAccent)
            .disabled(!model.canStartInstall || app.primaryDownloadURL.isEmpty)
        }
        .frame(width: 100)
    }

    // MARK: - IPA Row
    private func ipaRow(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 12) {
            if let iconData = ipa.iconData,
               let data = Data(base64Encoded: iconData),
               let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .appIconStyle(size: 52)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.secondary.opacity(0.12))
                    .frame(width: 52, height: 52)
                    .overlay {
                        Image(systemName: "app.fill")
                            .foregroundStyle(.secondary)
                    }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(ipa.bundleName).font(.subheadline.bold())
                Text("\(ipa.bundleId) · v\(ipa.bundleShortVersion)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let size = ipa.fileSize, size > 0 {
                    Text(formatSize(size))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary.opacity(0.5))
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Helpers
    private var sourceApps: [SourceAppDTO] {
        model.sourceCatalogs.flatMap { $0.manifest.apps }
    }

    private var filteredIpas: [IpaArtifactDTO] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return model.ipas }
        return model.ipas.filter { ipa in
            ipa.bundleName.localizedCaseInsensitiveContains(term) ||
            ipa.bundleId.localizedCaseInsensitiveContains(term)
        }
    }

    private func formatSize(_ bytes: Double) -> String {
        let mb = bytes / (1024 * 1024)
        if mb >= 1024 {
            return String(format: "%.1f GB", mb / 1024)
        }
        return String(format: "%.1f MB", mb)
    }
}
