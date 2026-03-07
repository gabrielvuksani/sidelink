import SwiftUI

struct SourcesTab: View {
    @ObservedObject var model: HelperViewModel
    @State private var showImportSheet = false
    @State private var showTrustedSources = false
    @Environment(\.colorScheme) private var colorScheme

    private var officialCatalog: SourceCatalog? {
        model.sourceCatalogs.first(where: { model.isOfficialSourceURL($0.sourceURL) })
    }

    private var customCatalogs: [SourceCatalog] {
        model.sourceCatalogs.filter { !model.isOfficialSourceURL($0.sourceURL) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent2)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        sourceHero

                        if let validationMessage = sourceValidationMessage {
                            Label(validationMessage, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.slDanger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(16)
                                .background((colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.82)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                                .padding(.horizontal, 20)
                        }

                        if !model.sourceCatalogFailures.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                SidelinkSectionIntro(eyebrow: "Needs Attention", title: "Some feeds did not load", subtitle: "The official source will stay pinned. Broken feeds will stop being noisy once fixed or removed.")
                                ForEach(model.sourceCatalogFailures, id: \.self) { failure in
                                    Label(failure, systemImage: "exclamationmark.triangle.fill")
                                        .font(.footnote)
                                        .foregroundStyle(Color.slWarning)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                            .liquidPanel()
                            .padding(.horizontal, 20)
                        }

                        if model.isLoading && model.sourceCatalogs.isEmpty {
                            VStack(spacing: 12) {
                                SkeletonRow(lineCount: 2)
                                SkeletonRow(lineCount: 2)
                                SkeletonRow(lineCount: 2)
                            }
                            .padding(.horizontal, 20)
                        } else {
                            if let officialCatalog {
                                VStack(alignment: .leading, spacing: 12) {
                                    SidelinkSectionIntro(eyebrow: "Pinned", title: "Official Source", subtitle: "This feed is always kept in place so Sidelink never starts empty.")
                                    NavigationLink(value: officialCatalog.id) {
                                        sourceCard(officialCatalog)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 20)
                            }

                            VStack(alignment: .leading, spacing: 12) {
                                SidelinkSectionIntro(eyebrow: "Library", title: customCatalogs.isEmpty ? "Your added sources" : "Added sources", subtitle: customCatalogs.isEmpty ? "Trusted sources live one tap away. Add feeds only when you actually want them." : "Only the sources you explicitly added stay here.")

                                if customCatalogs.isEmpty {
                                    emptySourcesState
                                } else {
                                    LazyVStack(spacing: 12) {
                                        ForEach(customCatalogs) { catalog in
                                            NavigationLink(value: catalog.id) {
                                                sourceCard(catalog)
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                    .padding(.vertical, 20)
                }
            }
            .refreshable {
                await model.refreshAll()
            }
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await model.refreshTrustedSources()
            }
            .navigationDestination(for: String.self) { catalogId in
                if let catalog = model.sourceCatalogs.first(where: { $0.id == catalogId }) {
                    sourceDetailView(catalog)
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Sources")
                        .font(.headline.weight(.semibold))
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

    private var sourceHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            SidelinkSectionIntro(eyebrow: "Sources", title: "A quieter source library", subtitle: "The official feed stays pinned, trusted feeds stay out of the way, and you can add more only when you need them.")

            HStack(spacing: 12) {
                SidelinkMetricTile(label: "Feeds", value: "\(model.sourceCatalogs.count)")
                SidelinkMetricTile(label: "Trusted", value: "\(model.trustedSources.count)", tint: .slAccent2)
            }

            HStack(spacing: 10) {
                Button {
                    showImportSheet = true
                } label: {
                    Label("Add Source", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.sidelinkQuickAction)

                Button {
                    showTrustedSources = true
                } label: {
                    Label("Trusted Sources", systemImage: "checkmark.shield")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.sidelinkQuickAction(tint: .slAccent2))
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
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

    // MARK: - Source Card
    private func sourceCard(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent
        let isBuiltIn = model.isOfficialSourceURL(catalog.sourceURL) ||
            catalog.sourceURL.caseInsensitiveCompare("https://cdn.altstore.io/file/altstore/apps.json") == .orderedSame

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
        .liquidPanel()
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
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

    private var emptySourcesState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("No custom sources yet")
                .font(.headline)
            Text("Use Trusted Sources for curated picks, or paste any AltStore-compatible source URL when you actually want it in your library.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .liquidPanel()
    }

    // MARK: - Source Detail View
    @ViewBuilder
    private func sourceDetailView(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent
        ZStack {
            SidelinkBackdrop(accent: tint)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    VStack(alignment: .leading, spacing: 18) {
                        if let headerURL = catalog.manifest.headerURL,
                           let url = URL(string: headerURL) {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image):
                                    image.resizable().aspectRatio(contentMode: .fill)
                                default:
                                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                                        .fill(
                                            LinearGradient(
                                                colors: [tint, tint.opacity(0.5)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            )
                                        )
                                }
                            }
                            .frame(height: 170)
                            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                        }

                        HStack(alignment: .top, spacing: 14) {
                            SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 58)
                            SidelinkSectionIntro(
                                eyebrow: "Source",
                                title: catalog.manifest.name,
                                subtitle: catalog.manifest.subtitle ?? catalog.manifest.description ?? catalog.sourceURL
                            )
                        }

                        HStack(spacing: 12) {
                            SidelinkMetricTile(label: "Apps", value: "\(catalog.manifest.apps.count)")
                            SidelinkMetricTile(label: "News", value: "\(catalog.manifest.news?.count ?? 0)", tint: .slAccent2)
                        }

                        if let website = catalog.manifest.website,
                           let url = URL(string: website) {
                            Link(destination: url) {
                                Label("Visit Source Website", systemImage: "safari")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.sidelinkQuickAction(tint: tint))
                        }
                    }
                    .liquidPanel()
                    .padding(.horizontal, 20)

                    if let news = catalog.manifest.news, !news.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Updates",
                                title: "Source news",
                                subtitle: "Recent notes and announcements published by this feed."
                            )

                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 12) {
                                    ForEach(news) { item in
                                        newsCard(item, tint: tint)
                                    }
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        SidelinkSectionIntro(
                            eyebrow: "Catalog",
                            title: "Available apps",
                            subtitle: "Everything currently exposed by this source, laid out as a browsable shelf."
                        )

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
                    }
                    .liquidPanel()
                    .padding(.horizontal, 20)
                }
                .padding(.vertical, 20)
            }
        }
        .navigationTitle(catalog.manifest.name)
        .navigationBarTitleDisplayMode(.inline)
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
                Text(SidelinkDateFormatting.relativeDate(dateStr))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: 180)
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.74))
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
                .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.74))
        }
    }
}

private struct SourceAppDetailView: View {
    @ObservedObject var model: HelperViewModel
    let catalog: SourceCatalog
    let app: SourceAppDTO
    @State private var showFullDescription = false
    @Environment(\.colorScheme) private var colorScheme

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

    private var appSubtitle: String {
        if let subtitle = app.subtitle, !subtitle.isEmpty {
            return subtitle
        }
        return app.bundleIdentifier
    }

    private var heroSubtitle: String {
        [app.developerName, "From \(catalog.manifest.name)"]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: " · ")
    }

    var body: some View {
        ZStack {
            SidelinkBackdrop(accent: tint)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(alignment: .top, spacing: 16) {
                            SidelinkAsyncImage(url: app.iconURL, size: 82)
                                .shadow(color: .black.opacity(0.18), radius: 10, y: 5)

                            VStack(alignment: .leading, spacing: 6) {
                                SidelinkSectionIntro(
                                    eyebrow: "Source App",
                                    title: app.name,
                                    subtitle: appSubtitle
                                )
                                Text(heroSubtitle)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }

                            Spacer(minLength: 0)
                        }

                        HStack(spacing: 12) {
                            SidelinkMetricTile(label: "Version", value: app.displayVersion)
                            SidelinkMetricTile(label: "Source", value: catalog.manifest.name, tint: .slAccent2)
                            if let size = app.versions?.first?.size ?? app.size, size > 0 {
                                SidelinkMetricTile(label: "Size", value: formatFileSize(size), tint: .slWarning)
                            }
                        }
                    }
                    .liquidPanel()
                    .padding(.horizontal, 20)

                    if let desc = app.localizedDescription, !desc.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Overview",
                                title: subtitleTitle,
                                subtitle: "The source-provided summary and metadata for this app."
                            )

                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(showFullDescription ? nil : 4)

                            Button(showFullDescription ? "Show Less" : "Read More") {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    showFullDescription.toggle()
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let screenshots = preferredScreenshots, !screenshots.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Preview",
                                title: "Screenshots",
                                subtitle: "Source artwork for a quick visual check before installing."
                            )

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(screenshots) { screenshot in
                                        AsyncImage(url: URL(string: screenshot.imageURL)) { phase in
                                            switch phase {
                                            case .success(let image):
                                                image.resizable().aspectRatio(contentMode: .fit)
                                            default:
                                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                                    .fill(.secondary.opacity(0.1))
                                            }
                                        }
                                        .frame(width: screenshotWidth, height: screenshotHeight)
                                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    }
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let versions = app.versions, !versions.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "History",
                                title: "Version timeline",
                                subtitle: "Release notes and compatibility data from the feed."
                            )

                            VStack(spacing: 10) {
                                ForEach(versions.prefix(6)) { version in
                                    VStack(alignment: .leading, spacing: 8) {
                                        HStack(alignment: .top, spacing: 12) {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(version.marketingVersion ?? version.version)
                                                    .font(.subheadline.weight(.semibold))
                                                if let date = version.date, !date.isEmpty {
                                                    Text(SidelinkDateFormatting.relativeDate(date))
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            if let minOS = version.minOSVersion, !minOS.isEmpty {
                                                PillBadge(text: "Min iOS \(minOS)", color: .slMuted, small: true)
                                            }
                                            if let size = version.size, size > 0 {
                                                PillBadge(text: formatFileSize(size), color: tint, small: true)
                                            }
                                        }
                                        if let description = version.localizedDescription, !description.isEmpty {
                                            Text(description)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .sidelinkInsetPanel()
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if hasPermissions {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Security",
                                title: "Permissions",
                                subtitle: "Entitlements and privacy descriptions surfaced by the source."
                            )

                            if let entitlements = app.appPermissions?.entitlements, !entitlements.isEmpty {
                                VStack(spacing: 10) {
                                    ForEach(entitlements, id: \.self) { entitlement in
                                        Label(entitlement, systemImage: "lock.shield")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .sidelinkInsetPanel()
                                    }
                                }
                            }

                            if let privacy = app.appPermissions?.privacy, !privacy.isEmpty {
                                VStack(spacing: 10) {
                                    ForEach(privacy.keys.sorted(), id: \.self) { key in
                                        HStack(alignment: .top, spacing: 12) {
                                            Text(key)
                                                .font(.caption.weight(.semibold))
                                            Spacer(minLength: 12)
                                            Text(privacy[key] ?? "")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .multilineTextAlignment(.trailing)
                                        }
                                        .sidelinkInsetPanel()
                                    }
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let website = catalog.manifest.website, let url = URL(string: website) {
                        Link(destination: url) {
                            Label("Open Source Website", systemImage: "safari")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.sidelinkQuickAction(tint: tint))
                        .padding(.horizontal, 20)
                    }

                    Spacer(minLength: 96)
                }
                .padding(.vertical, 20)
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if let readiness = model.installReadinessMessage {
                    Label(readiness, systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(Color.slWarning)
                } else {
                    Text(model.primarySigningSummary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task {
                        await model.installFromSource(
                            app,
                            sourceName: catalog.manifest.name,
                            subtitle: "Installing from \(catalog.manifest.name)"
                        )
                    }
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
            .background(colorScheme == .dark ? Color.black.opacity(0.88) : Color.white.opacity(0.82))
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

    private var subtitleTitle: String {
        if let subtitle = app.subtitle, !subtitle.isEmpty {
            return subtitle
        }
        return "About this app"
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
