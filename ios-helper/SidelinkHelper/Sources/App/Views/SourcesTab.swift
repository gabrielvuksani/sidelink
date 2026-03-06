import SwiftUI

struct SourcesTab: View {
    @ObservedObject var model: HelperViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // MARK: - Add Source
                    HStack(spacing: 10) {
                        TextField("https://example.com/source.json", text: $model.sourceURLInput)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .textFieldStyle(.roundedBorder)

                        Button {
                            SidelinkHaptics.impact(.light)
                            Task { await model.addCustomSource() }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title2)
                        }
                        .disabled(!canSubmitSource)
                    }
                    .padding(.horizontal)

                    if let validationMessage = sourceValidationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(Color.slDanger)
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
                            Text("Add a source URL above to discover and install apps from community repositories.")
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
            .navigationDestination(for: String.self) { catalogId in
                if let catalog = model.sourceCatalogs.first(where: { $0.id == catalogId }) {
                    sourceDetailView(catalog)
                }
            }
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
        model.isPaired && !model.isLoading && !trimmedSourceURL.isEmpty && sourceValidationMessage == nil
    }

    private func isLocalHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        if lower == "localhost" || lower.hasSuffix(".local") {
            return true
        }

        let parts = lower.split(separator: ".")
        guard parts.count == 4,
              let a = Int(parts[0]),
              let b = Int(parts[1]) else {
            return false
        }

        if a == 10 || a == 127 || (a == 192 && b == 168) {
            return true
        }
        return a == 172 && (16...31).contains(b)
    }

    // MARK: - Source Card
    private func sourceCard(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent
        let isBuiltIn = catalog.sourceURL.lowercased().contains("altstore.io") ||
                         catalog.sourceURL.lowercased().contains("github")

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
                            sourceAppGridItem(app, tint: tint)
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
            .tint(Color(hex: app.tintColor) ?? tint)
            .disabled(!model.canStartInstall || app.primaryDownloadURL.isEmpty)
        }
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        }
    }

    private func formatSize(_ bytes: Double) -> String {
        let mb = bytes / 1_048_576
        if mb >= 1024 { return String(format: "%.1f GB", mb / 1024) }
        if mb >= 1 { return String(format: "%.1f MB", mb) }
        return String(format: "%.0f KB", max(1, bytes / 1024))
    }
}
