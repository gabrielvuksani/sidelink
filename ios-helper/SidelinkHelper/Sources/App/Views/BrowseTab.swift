import SwiftUI

struct BrowseTab: View {
    @ObservedObject var model: HelperViewModel

    private var featuredSourceApps: [SourceAppDTO] {
        var seen = Set<String>()
        let apps = model.sourceCatalogs.flatMap { catalog -> [SourceAppDTO] in
            let featuredIDs = Set(catalog.manifest.featuredApps ?? [])
            if featuredIDs.isEmpty {
                return Array(catalog.manifest.apps.prefix(2))
            }
            return catalog.manifest.apps.filter { featuredIDs.contains($0.bundleIdentifier) }
        }

        return apps.filter { app in
            seen.insert(app.bundleIdentifier).inserted
        }
    }

    private var newsCards: [SourceNewsDTO] {
        model.sourceCatalogs
            .compactMap { $0.manifest.news }
            .flatMap { $0 }
            .sorted { ($0.date ?? "") > ($1.date ?? "") }
    }

    private var recentLibrary: [IpaArtifactDTO] {
        Array(model.ipas.prefix(6))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                homeBackground
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        homeHero

                        if let readiness = model.installReadinessMessage {
                            attentionBanner(readiness)
                        }

                        if !newsCards.isEmpty {
                            sectionHeader("What’s New", subtitle: "Updates from your connected sources")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(newsCards.prefix(8)) { item in
                                        newsCard(item)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if !featuredSourceApps.isEmpty {
                            sectionHeader("Featured Apps", subtitle: "Handpicked from source feeds")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(featuredSourceApps.prefix(12)) { app in
                                        NavigationLink {
                                            SourceAppShowcaseView(model: model, app: app)
                                        } label: {
                                            featuredAppCard(app)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if let latest = model.latestUploadedIpa {
                            sectionHeader("Latest Upload", subtitle: "Continue from your own library")

                            NavigationLink {
                                AppDetailView(model: model, ipa: latest)
                            } label: {
                                latestUploadCard(latest)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 20)
                        }

                        if !recentLibrary.isEmpty {
                            sectionHeader("Library Highlights", subtitle: "Recent IPAs ready to sign")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(recentLibrary) { ipa in
                                        NavigationLink {
                                            AppDetailView(model: model, ipa: ipa)
                                        } label: {
                                            libraryCard(ipa)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if !model.sourceCatalogs.isEmpty {
                            sectionHeader("Collections", subtitle: "Browse by source catalog")

                            VStack(spacing: 14) {
                                ForEach(model.sourceCatalogs) { catalog in
                                    NavigationLink {
                                        SourceCatalogShowcaseView(model: model, catalog: catalog)
                                    } label: {
                                        sourceCollectionCard(catalog)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 20)
                        }

                        if model.sourceCatalogs.isEmpty && model.ipas.isEmpty {
                            EmptyStateCard(
                                icon: "square.stack.3d.up.slash",
                                title: "Nothing Connected Yet",
                                message: "Add a source or upload an IPA from Installed to start building your library."
                            )
                            .padding(.horizontal, 20)
                        }
                    }
                    .padding(.vertical, 18)
                }
                .refreshable {
                    await model.refreshAll()
                }
            }
            .navigationTitle("Home")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var homeBackground: some View {
        LinearGradient(
            colors: [Color(red: 0.93, green: 0.97, blue: 1.0), Color.white, Color(red: 0.96, green: 0.99, blue: 0.98)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(Color.slAccent.opacity(0.1))
                .frame(width: 240, height: 240)
                .blur(radius: 18)
                .offset(x: 70, y: -50)
        }
    }

    private var homeHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your sideloading home base")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("Track installs, browse trusted sources, and keep your library ready without jumping between screens.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.84))

            HStack(spacing: 12) {
                overviewPill(title: "Sources", value: "\(model.sourceCatalogs.count)")
                overviewPill(title: "Library", value: "\(model.ipas.count)")
                overviewPill(title: "Slots", value: "\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots)")
            }

            HStack(spacing: 12) {
                Label(model.selectedAccount?.appleId ?? "No Apple ID selected", systemImage: "person.crop.circle")
                Spacer()
                Label(model.selectedDevice?.name ?? "No Device", systemImage: "iphone")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.82))
        }
        .padding(24)
        .background(
            LinearGradient(
                colors: [Color.slAccent, Color.slAccent2, Color(red: 0.06, green: 0.2, blue: 0.28)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 30, style: .continuous)
        )
        .padding(.horizontal, 20)
    }

    private func attentionBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield")
                .foregroundStyle(Color.slWarning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.primary)
            Spacer()
        }
        .padding(16)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 20)
    }

    private func sectionHeader(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title3.bold())
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
    }

    private func newsCard(_ item: SourceNewsDTO) -> some View {
        let tint = Color(hex: item.tintColor) ?? .slAccent

        return VStack(alignment: .leading, spacing: 12) {
            PillBadge(text: item.date ?? "Source update", color: tint, small: true)
            Text(item.title)
                .font(.headline)
                .foregroundStyle(.primary)
            if let caption = item.caption, !caption.isEmpty {
                Text(caption)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }
            Spacer()
        }
        .frame(width: 260, height: 170, alignment: .topLeading)
        .padding(18)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func featuredAppCard(_ app: SourceAppDTO) -> some View {
        let tint = Color(hex: app.tintColor) ?? .slAccent

        return VStack(alignment: .leading, spacing: 12) {
            SidelinkAsyncImage(url: app.iconURL, size: 62)

            VStack(alignment: .leading, spacing: 4) {
                Text(app.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(app.subtitle ?? app.bundleIdentifier)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Spacer()

            HStack {
                PillBadge(text: app.displayVersion, color: tint, small: true)
                Spacer()
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundStyle(tint)
            }
        }
        .frame(width: 220, height: 250, alignment: .topLeading)
        .padding(18)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func latestUploadCard(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 16) {
            appIcon(for: ipa, size: 70)

            VStack(alignment: .leading, spacing: 5) {
                Text(ipa.bundleName)
                    .font(.title3.bold())
                    .foregroundStyle(.primary)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let uploadedAt = ipa.uploadedAt {
                    Text("Uploaded \(uploadedAt)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func libraryCard(_ ipa: IpaArtifactDTO) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            appIcon(for: ipa, size: 58)

            VStack(alignment: .leading, spacing: 4) {
                Text(ipa.bundleName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            Text("v\(ipa.bundleShortVersion)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(width: 190, height: 210, alignment: .topLeading)
        .padding(16)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func sourceCollectionCard(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent

        return HStack(spacing: 14) {
            SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 54)

            VStack(alignment: .leading, spacing: 4) {
                Text(catalog.manifest.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(catalog.manifest.subtitle ?? catalog.manifest.description ?? "\(catalog.manifest.apps.count) apps available")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            PillBadge(text: "\(catalog.manifest.apps.count) apps", color: tint, small: true)
        }
        .padding(16)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder
    private func appIcon(for ipa: IpaArtifactDTO, size: CGFloat) -> some View {
        if let iconData = ipa.iconData,
           let data = Data(base64Encoded: iconData),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .appIconStyle(size: size)
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.secondary.opacity(0.12))
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "app.fill")
                        .foregroundStyle(.secondary)
                }
        }
    }

    private func overviewPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.74))
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct SearchTab: View {
    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case library = "Library"
        case sources = "Sources"

        var id: String { rawValue }
    }

    @ObservedObject var model: HelperViewModel
    @State private var query = ""
    @State private var scope: Scope = .all

    private var sourceApps: [SourceAppDTO] {
        model.sourceApps
    }

    private var filteredIpas: [IpaArtifactDTO] {
        guard !queryTrimmed.isEmpty else { return model.ipas }
        return model.ipas.filter { ipa in
            ipa.bundleName.localizedCaseInsensitiveContains(queryTrimmed)
            || ipa.bundleId.localizedCaseInsensitiveContains(queryTrimmed)
        }
    }

    private var filteredSourceApps: [SourceAppDTO] {
        guard !queryTrimmed.isEmpty else { return sourceApps }
        return sourceApps.filter { app in
            app.name.localizedCaseInsensitiveContains(queryTrimmed)
            || app.bundleIdentifier.localizedCaseInsensitiveContains(queryTrimmed)
            || (app.developerName?.localizedCaseInsensitiveContains(queryTrimmed) ?? false)
        }
    }

    private var queryTrimmed: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Scope", selection: $scope) {
                        ForEach(Scope.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                }

                if (scope == .all || scope == .library) && !filteredIpas.isEmpty {
                    Section("Library") {
                        ForEach(filteredIpas) { ipa in
                            NavigationLink {
                                AppDetailView(model: model, ipa: ipa)
                            } label: {
                                ipaResultRow(ipa)
                            }
                        }
                    }
                }

                if (scope == .all || scope == .sources) && !filteredSourceApps.isEmpty {
                    Section("Sources") {
                        ForEach(filteredSourceApps) { app in
                            NavigationLink {
                                SourceAppShowcaseView(model: model, app: app)
                            } label: {
                                sourceResultRow(app)
                            }
                        }
                    }
                }

                if filteredIpas.isEmpty && filteredSourceApps.isEmpty {
                    Section {
                        EmptyStateCard(
                            icon: "magnifyingglass",
                            title: queryTrimmed.isEmpty ? "Search Your Library And Sources" : "No Matches",
                            message: queryTrimmed.isEmpty
                                ? "Search across uploaded IPAs and apps from connected AltStore-compatible feeds."
                                : "Try another app name, bundle identifier, or developer name."
                        )
                        .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search apps and sources")
        }
    }

    private func ipaResultRow(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 14) {
            if let iconData = ipa.iconData,
               let data = Data(base64Encoded: iconData),
               let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .appIconStyle(size: 52)
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.secondary.opacity(0.12))
                    .frame(width: 52, height: 52)
                    .overlay {
                        Image(systemName: "app.fill")
                            .foregroundStyle(.secondary)
                    }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(ipa.bundleName)
                    .font(.headline)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()
            PillBadge(text: "Library", color: .slAccent, small: true)
        }
    }

    private func sourceResultRow(_ app: SourceAppDTO) -> some View {
        let tint = Color(hex: app.tintColor) ?? .slAccent

        return HStack(spacing: 14) {
            SidelinkAsyncImage(url: app.iconURL, size: 52)

            VStack(alignment: .leading, spacing: 3) {
                Text(app.name)
                    .font(.headline)
                Text(app.subtitle ?? app.bundleIdentifier)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()
            PillBadge(text: "Source", color: tint, small: true)
        }
    }
}

private struct EmptyStateCard: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 42))
                .foregroundStyle(Color.slAccent)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

private struct SourceCatalogShowcaseView: View {
    @ObservedObject var model: HelperViewModel
    let catalog: SourceCatalog

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 60)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(catalog.manifest.name)
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                            Text(catalog.manifest.subtitle ?? catalog.manifest.description ?? catalog.sourceURL)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text("\(catalog.manifest.apps.count) apps available")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)

                VStack(spacing: 10) {
                    ForEach(catalog.manifest.apps) { app in
                        NavigationLink {
                            SourceAppShowcaseView(model: model, app: app)
                        } label: {
                            HStack(spacing: 14) {
                                SidelinkAsyncImage(url: app.iconURL, size: 48)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(app.name)
                                        .font(.headline)
                                    Text(app.subtitle ?? app.bundleIdentifier)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.bold())
                                    .foregroundStyle(.secondary)
                            }
                            .padding(16)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.vertical, 18)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(catalog.manifest.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SourceAppShowcaseView: View {
    @ObservedObject var model: HelperViewModel
    let app: SourceAppDTO

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 16) {
                        SidelinkAsyncImage(url: app.iconURL, size: 76)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(app.name)
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                            Text(app.subtitle ?? app.bundleIdentifier)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            if let developer = app.developerName {
                                Text(developer)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color(hex: app.tintColor) ?? .slAccent)
                            }
                        }
                    }

                    if let description = app.localizedDescription, !description.isEmpty {
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 10) {
                        PillBadge(text: app.displayVersion, color: Color(hex: app.tintColor) ?? .slAccent, small: true)
                        if let category = app.category, !category.isEmpty {
                            PillBadge(text: category, color: .slAccent2, small: true)
                        }
                    }
                }
                .padding(.horizontal, 20)

                if let screenshots = app.screenshots?.iphone, !screenshots.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Screenshots")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(screenshots) { item in
                                    AsyncImage(url: URL(string: item.imageURL)) { phase in
                                        if case .success(let image) = phase {
                                            image.resizable().aspectRatio(contentMode: .fill)
                                        } else {
                                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                                .fill(Color.slAccent.opacity(0.12))
                                        }
                                    }
                                    .frame(width: 180, height: 360)
                                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                }

                if let versions = app.versions, !versions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Release Notes")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        VStack(spacing: 10) {
                            ForEach(versions.prefix(4)) { version in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("v\(version.version)")
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
                                }
                                .padding(16)
                                .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }

                if let permissions = app.appPermissions {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Permissions")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        VStack(alignment: .leading, spacing: 8) {
                            if let entitlements = permissions.entitlements {
                                ForEach(entitlements, id: \.self) { entitlement in
                                    Label(entitlement, systemImage: "lock.shield")
                                        .font(.caption)
                                }
                            }
                            if let privacy = permissions.privacy {
                                ForEach(privacy.keys.sorted(), id: \.self) { key in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(key)
                                            .font(.caption.bold())
                                        Text(privacy[key] ?? "")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .padding(.horizontal, 20)
                    }
                }
            }
            .padding(.vertical, 18)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await model.installFromSource(app) }
            } label: {
                Label("Install", systemImage: "arrow.down.app.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(hex: app.tintColor) ?? .slAccent)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)
            .disabled(!model.canStartInstall || app.primaryDownloadURL.isEmpty)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
    }
}