import SwiftUI

struct SourcesTab: View {
    @ObservedObject var model: HelperViewModel
    @State private var showImportSheet = false
    @State private var showTrustedSources = false

    private var featuredTrustedSources: [TrustedSourceDTO] {
        Array(model.trustedSources.prefix(3))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Import AltStore-compatible sources and browse them here.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Text("Source browsing works even before helper pairing.")
                            .font(.caption)
                            .foregroundStyle(.tertiary)

                        HStack(spacing: 12) {
                            Button {
                                showImportSheet = true
                            } label: {
                                Label("Import Source", systemImage: "square.and.arrow.down")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)

                            Button {
                                showTrustedSources = true
                            } label: {
                                Label("Trusted", systemImage: "checkmark.shield")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.horizontal)
                    .sidelinkCard()
                    .padding(.horizontal)

                    if !model.trustedSources.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Trusted Sources")
                                    .sectionHeader()
                                Spacer()
                                Button("View All") {
                                    showTrustedSources = true
                                }
                                .font(.subheadline.weight(.semibold))
                            }

                            ForEach(featuredTrustedSources) { source in
                                trustedSourceRow(source)
                            }
                        }
                        .padding(.horizontal)
                    }

                    if let validationMessage = sourceValidationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(Color.slDanger)
                            .padding(.horizontal)
                    }

                    if !model.sourceCatalogFailures.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Needs Attention")
                                .sectionHeader()

                            ForEach(model.sourceCatalogFailures, id: \.self) { failure in
                                Label(failure, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(Color.slWarning)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(.horizontal)
                    }

                    // MARK: - Source Cards
                    if model.isLoading && model.sourceCatalogs.isEmpty {
                        VStack(spacing: 12) {
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                            SkeletonRow(lineCount: 2)
                        }
                        .padding(.horizontal)
                    } else if model.sourceCatalogs.isEmpty {
                        VStack(spacing: 16) {
                            ZStack {
                                Circle()
                                    .fill(.secondary.opacity(0.08))
                                    .frame(width: 100, height: 100)
                                Image(systemName: "books.vertical.fill")
                                    .font(.system(size: 40))
                                    .foregroundStyle(.secondary.opacity(0.4))
                            }
                            Text("No sources")
                                .font(.title3.bold())
                                .foregroundStyle(.secondary)
                            Text("Import a source to discover and install apps from community repositories.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(model.sourceCatalogs) { catalog in
                                NavigationLink(value: catalog.id) {
                                    sourceCard(catalog)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .refreshable {
                await model.refreshAll()
            }
            .navigationTitle("Sources")
            .task {
                await model.refreshTrustedSources()
            }
            .navigationDestination(for: String.self) { catalogId in
                if let catalog = model.sourceCatalogs.first(where: { $0.id == catalogId }) {
                    sourceDetailView(catalog)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showImportSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
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
            .sheet(isPresented: $showTrustedSources) {
                NavigationStack {
                    TrustedSourcesView(model: model)
                }
            }
        }
    }

    private var importSheet: some View {
        NavigationStack {
            Form {
                Section("Import Source") {
                    TextField("https://example.com/source.json", text: $model.sourceURLInput)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)

                    if let validationMessage = sourceValidationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(Color.slDanger)
                    }

                    Button {
                        Task {
                            await model.addCustomSource()
                            if model.errorMessage == nil {
                                showImportSheet = false
                            }
                        }
                    } label: {
                        Label("Import Source", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSubmitSource)
                }
            }
            .navigationTitle("Import Source")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showImportSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var trimmedSourceURL: String {
        model.sourceURLInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var sourceValidationMessage: String? {
        guard !trimmedSourceURL.isEmpty else { return nil }
        guard let url = URL(string: trimmedSourceURL),
              let scheme = url.scheme?.lowercased(),
              let host = url.host else {
            return "Enter a valid source URL"
        }
        guard scheme == "https" || scheme == "http" else {
            return "Source URLs must use http or https"
        }
        if scheme == "http" && !isLocalHost(host) {
            return "HTTP sources are only allowed for local-network hosts"
        }
        return nil
    }

    private var canSubmitSource: Bool {
        !model.isLoading && !trimmedSourceURL.isEmpty && sourceValidationMessage == nil
    }

    private func isLocalHost(_ host: String) -> Bool {
        SidelinkNetworkUtil.isLocalHost(host)
    }

    private func trustedSourceRow(_ source: TrustedSourceDTO) -> some View {
        HStack(spacing: 12) {
            SidelinkAsyncImage(url: source.iconURL, size: 42)

            VStack(alignment: .leading, spacing: 4) {
                Text(source.name)
                    .font(.subheadline.bold())
                if let description = source.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Button {
                Task { await model.addTrustedSource(source) }
            } label: {
                Text("Add")
                    .font(.caption.bold())
                    .padding(.horizontal, 10)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .sidelinkCard()
    }

    // MARK: - Source Card
    private func sourceCard(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent
        let lowerURL = catalog.sourceURL.lowercased()
        let isBuiltIn = lowerURL == "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source.json" ||
            lowerURL == "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json" ||
            lowerURL == "https://cdn.altstore.io/file/altstore/apps.json"

        return HStack(spacing: 14) {
            SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 48)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(catalog.manifest.name)
                        .font(.subheadline.bold())
                        .foregroundStyle(.primary)
                    if isBuiltIn {
                        PillBadge(text: "Built-in", color: .yellow, small: true)
                    }
                }
                if let subtitle = catalog.manifest.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text("\(catalog.manifest.apps.count) apps")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()

            Circle()
                .fill(tint)
                .frame(width: 10, height: 10)

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary.opacity(0.5))
        }
        .sidelinkCard()
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.3), lineWidth: 1)
        )
        .contextMenu {
            if !isBuiltIn && model.customSourceURLs.contains(catalog.sourceURL) {
                Button(role: .destructive) {
                    Task { await model.removeCustomSource(catalog.sourceURL) }
                } label: {
                    Label("Remove Source", systemImage: "trash")
                }
            }
        }
    }

    // MARK: - Source Detail View
    @ViewBuilder
    private func sourceDetailView(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent

        ScrollView {
            VStack(spacing: 20) {
                // Header image
                if let headerURL = catalog.manifest.headerURL,
                   let url = URL(string: headerURL) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().aspectRatio(contentMode: .fill)
                        default:
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [tint, tint.opacity(0.5)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        }
                    }
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.horizontal)
                }

                // Source info
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 12) {
                        SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(catalog.manifest.name)
                                .font(.title3.bold())
                            Text("\(catalog.manifest.apps.count) apps")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let desc = catalog.manifest.description, !desc.isEmpty {
                        Text(desc)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    if let website = catalog.manifest.website,
                       let url = URL(string: website) {
                        Link(destination: url) {
                            Label("Visit Source Website", systemImage: "safari")
                                .font(.caption.bold())
                        }
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                // MARK: - News Carousel
                if let news = catalog.manifest.news, !news.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("News")
                            .sectionHeader()
                            .padding(.horizontal)

                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 12) {
                                ForEach(news) { item in
                                    newsCard(item, tint: tint)
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                }

                // MARK: - App Grid
                VStack(alignment: .leading, spacing: 12) {
                    Text("Apps")
                        .sectionHeader()
                        .padding(.horizontal)

                    let columns = [
                        GridItem(.flexible(), spacing: 12),
                        GridItem(.flexible(), spacing: 12),
                    ]
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(catalog.manifest.apps) { app in
                            NavigationLink {
                                SourceAppDetailView(model: model, catalog: catalog, app: app)
                            } label: {
                                sourceAppGridItem(app, tint: tint)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(catalog.manifest.name)
    }

    // MARK: - News Card
    private func newsCard(_ item: SourceNewsDTO, tint: Color) -> some View {
        let cardTint = Color(hex: item.tintColor) ?? tint

        return VStack(alignment: .leading, spacing: 6) {
            if let imageURL = item.imageURL, let url = URL(string: imageURL) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(cardTint.opacity(0.15))
                    }
                }
                .frame(height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            Text(item.title)
                .font(.caption.bold())
                .lineLimit(2)
            if let caption = item.caption {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if let dateStr = item.date {
                Text(dateStr)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: 180)
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.ultraThinMaterial)
        }
    }

    // MARK: - Source App Grid Item with Screenshots
    private func sourceAppGridItem(_ app: SourceAppDTO, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                SidelinkAsyncImage(url: app.iconURL, size: 44)

                VStack(alignment: .leading, spacing: 2) {
                    Text(app.name)
                        .font(.caption.bold())
                        .lineLimit(1)
                    if let dev = app.developerName {
                        Text(dev)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }

            // Screenshots
            if let screenshots = app.screenshots?.iphone, !screenshots.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(screenshots.prefix(3)) { ss in
                            AsyncImage(url: URL(string: ss.imageURL)) { phase in
                                if case .success(let image) = phase {
                                    image.resizable().aspectRatio(contentMode: .fill)
                                } else {
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(.secondary.opacity(0.1))
                                }
                            }
                            .frame(width: 60, height: 106)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                }
                .frame(height: 106)
            }

            HStack(spacing: 8) {
                PillBadge(text: app.displayVersion, color: Color(hex: app.tintColor) ?? tint, small: true)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        }
    }

    private func formatSize(_ bytes: Double) -> String {
        SidelinkFormatting.fileSize(bytes)
    }
}

private struct SourceAppDetailView: View {
    @ObservedObject var model: HelperViewModel
    let catalog: SourceCatalog
    let app: SourceAppDTO
    @State private var showFullDescription = false

    private var isInstalled: Bool {
        model.installedApps.contains {
            $0.bundleId == app.bundleIdentifier || $0.originalBundleId == app.bundleIdentifier
        }
    }

    private var tint: Color {
        Color(hex: app.tintColor) ?? Color(hex: catalog.manifest.tintColor) ?? .slAccent
    }

    private var installLabel: String {
        isInstalled ? "Reinstall" : "Install"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ZStack(alignment: .bottomLeading) {
                    LinearGradient(
                        colors: [tint, tint.opacity(0.55), .clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .frame(height: 220)

                    HStack(spacing: 16) {
                        SidelinkAsyncImage(url: app.iconURL, size: 82)
                            .shadow(color: .black.opacity(0.18), radius: 10, y: 5)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(app.name)
                                .font(.title2.bold())
                                .foregroundStyle(.white)
                            Text(app.bundleIdentifier)
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.74))
                            Text([app.developerName, "From \(catalog.manifest.name)"]
                                .compactMap { value in
                                    guard let value, !value.isEmpty else { return nil }
                                    return value
                                }
                                .joined(separator: " · "))
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.7))
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }

                VStack(spacing: 20) {
                    HStack(spacing: 0) {
                        infoCell("Version", app.displayVersion)
                        Divider().frame(height: 28)
                        infoCell("Source", catalog.manifest.name)
                        if let size = app.versions?.first?.size ?? app.size, size > 0 {
                            Divider().frame(height: 28)
                            infoCell("Size", formatFileSize(size))
                        }
                    }
                    .padding(.vertical, 8)

                    if let subtitle = app.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                    }

                    if let desc = app.localizedDescription, !desc.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(showFullDescription ? nil : 4)
                            Button(showFullDescription ? "Show Less" : "Read More") {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    showFullDescription.toggle()
                                }
                            }
                            .font(.subheadline.bold())
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                    }

                    if let screenshots = preferredScreenshots, !screenshots.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Screenshots")
                                .sectionHeader()
                                .padding(.horizontal)

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    ForEach(screenshots) { screenshot in
                                        AsyncImage(url: URL(string: screenshot.imageURL)) { phase in
                                            switch phase {
                                            case .success(let image):
                                                image.resizable().aspectRatio(contentMode: .fit)
                                            default:
                                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                                    .fill(.secondary.opacity(0.1))
                                            }
                                        }
                                        .frame(width: screenshotWidth, height: screenshotHeight)
                                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }

                    if let versions = app.versions, !versions.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Version History")
                                .sectionHeader()
                                .padding(.horizontal)

                            ForEach(versions.prefix(6)) { version in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(version.marketingVersion ?? version.version)
                                            .font(.subheadline.bold())
                                        Spacer()
                                        if let date = version.date {
                                            Text(date)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    if let description = version.localizedDescription, !description.isEmpty {
                                        Text(description)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    HStack(spacing: 8) {
                                        if let minOS = version.minOSVersion, !minOS.isEmpty {
                                            PillBadge(text: "Min iOS \(minOS)", color: .slMuted, small: true)
                                        }
                                        if let size = version.size, size > 0 {
                                            PillBadge(text: formatFileSize(size), color: tint, small: true)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                                Divider().padding(.horizontal)
                            }
                        }
                    }

                    if hasPermissions {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Permissions")
                                .sectionHeader()
                                .padding(.horizontal)

                            if let entitlements = app.appPermissions?.entitlements, !entitlements.isEmpty {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(entitlements, id: \.self) { entitlement in
                                        Label(entitlement, systemImage: "lock.shield")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal)
                            }

                            if let privacy = app.appPermissions?.privacy, !privacy.isEmpty {
                                ForEach(privacy.keys.sorted(), id: \.self) { key in
                                    HStack(alignment: .top) {
                                        Text(key)
                                            .font(.caption.bold())
                                        Spacer()
                                        Text(privacy[key] ?? "")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .multilineTextAlignment(.trailing)
                                    }
                                    .padding(.horizontal)
                                }
                            }
                        }
                    }

                    if let website = catalog.manifest.website, let url = URL(string: website) {
                        Link(destination: url) {
                            Label("Open Source Website", systemImage: "safari")
                                .font(.subheadline.bold())
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .padding(.horizontal)
                    }

                    Spacer(minLength: 80)
                }
                .padding(.top, 16)
            }
        }
        .ignoresSafeArea(edges: .top)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if let readiness = model.installReadinessMessage {
                    Label(readiness, systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(Color.slWarning)
                }

                Button {
                    Task { await model.installFromSource(app) }
                } label: {
                    Label(installLabel, systemImage: isInstalled ? "arrow.clockwise" : "arrow.down.app.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(tint)
                .disabled(model.installReadinessMessage != nil || app.primaryDownloadURL.isEmpty)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private var preferredScreenshots: [SourceScreenshotDTO]? {
        if let iphone = app.screenshots?.iphone, !iphone.isEmpty {
            return iphone
        }
        if let ipad = app.screenshots?.ipad, !ipad.isEmpty {
            return ipad
        }
        return nil
    }

    private var hasPermissions: Bool {
        !(app.appPermissions?.entitlements?.isEmpty ?? true) || !(app.appPermissions?.privacy?.isEmpty ?? true)
    }

    private func infoCell(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.bold())
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private func formatFileSize(_ bytes: Double) -> String {
        SidelinkFormatting.fileSize(bytes)
    }

    private var screenshotWidth: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 220 : 150
    }

    private var screenshotHeight: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 392 : 266
    }
}
