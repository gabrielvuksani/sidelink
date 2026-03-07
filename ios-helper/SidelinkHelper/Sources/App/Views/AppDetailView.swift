import SwiftUI

struct AppDetailView: View {
    @ObservedObject var model: HelperViewModel
    let ipa: IpaArtifactDTO
    @State private var showFullDescription = false
    @Environment(\.colorScheme) private var colorScheme

    /// Check if this IPA is already installed
    private var isInstalled: Bool {
        model.installedApps.contains { $0.bundleId == ipa.bundleId || $0.originalBundleId == ipa.bundleId }
    }

    private var installButtonLabel: String {
        if isInstalled { return "Reinstall" }
        return "Install"
    }

    private var matchingSourceCatalog: SourceCatalog? {
        model.sourceCatalogs.first { catalog in
            catalog.manifest.apps.contains { $0.bundleIdentifier == ipa.bundleId }
        }
    }

    private var heroSubtitle: String {
        [matchingSourceApp?.developerName, matchingSourceCatalog?.manifest.name]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: " · ")
    }

    var body: some View {
        ZStack {
            SidelinkBackdrop(accent: .slAccent)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    heroCard

                    if let desc = matchingSourceApp?.localizedDescription, !desc.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Overview",
                                title: "About this build",
                                subtitle: "This is the library copy you can install, reinstall, and audit before signing."
                            )

                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(showFullDescription ? nil : 4)

                            Button(showFullDescription ? "Show Less" : "Read More") {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    showFullDescription.toggle()
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let screenshots = matchingSourceApp?.screenshots?.iphone, !screenshots.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Preview",
                                title: "Screenshots",
                                subtitle: "Reference captures from the source listing for this app."
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

                    if let versions = matchingSourceApp?.versions, versions.count > 1 {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "History",
                                title: "Version timeline",
                                subtitle: "Recent release notes from the source feed, grouped in readable cards."
                            )

                            VStack(spacing: 12) {
                                ForEach(versions.prefix(5)) { version in
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
                                                PillBadge(text: formatFileSize(size), color: .slAccent2, small: true)
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

                    VStack(alignment: .leading, spacing: 14) {
                        SidelinkSectionIntro(
                            eyebrow: "Package",
                            title: "Build details",
                            subtitle: "The bundle metadata SideLink will use while installing this IPA."
                        )

                        VStack(spacing: 10) {
                            DetailRow(label: "Bundle ID", value: ipa.bundleId, icon: "shippingbox")
                            DetailRow(label: "File", value: ipa.originalName, icon: "doc.zipper")
                            if let build = ipa.bundleVersion, build != ipa.bundleShortVersion {
                                DetailRow(label: "Build", value: build, icon: "hammer")
                            }
                            if let minOS = ipa.minOsVersion, !minOS.isEmpty {
                                DetailRow(label: "Minimum iOS", value: minOS, icon: "iphone")
                            }
                            if let exts = ipa.extensions, !exts.isEmpty {
                                DetailRow(label: "Extensions", value: "\(exts.count)", icon: "puzzlepiece.extension")
                            }
                        }
                    }
                    .liquidPanel()
                    .padding(.horizontal, 20)

                    if let exts = ipa.extensions, !exts.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Extension Targets",
                                title: "Embedded extensions",
                                subtitle: "Extra extension bundles packaged inside this IPA."
                            )

                            VStack(spacing: 10) {
                                ForEach(exts) { ext in
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(systemName: "puzzlepiece.extension")
                                            .foregroundStyle(.secondary)
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(ext.name)
                                                .font(.subheadline.weight(.semibold))
                                            Text(ext.bundleId)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                    .sidelinkInsetPanel()
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let entitlements = ipa.entitlements, !entitlements.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Security",
                                title: "Entitlements",
                                subtitle: "Capabilities declared inside the IPA payload."
                            )

                            VStack(spacing: 10) {
                                ForEach(Array(entitlements.keys).sorted(), id: \.self) { key in
                                    HStack(alignment: .top, spacing: 12) {
                                        Text(key)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.primary)
                                        Spacer(minLength: 12)
                                        Text(describeEntitlement(entitlements[key]?.value))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .multilineTextAlignment(.trailing)
                                    }
                                    .sidelinkInsetPanel()
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    if let perms = matchingSourceApp?.appPermissions,
                       (!(perms.entitlements?.isEmpty ?? true) || !(perms.privacy?.isEmpty ?? true)) {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Source Review",
                                title: "Permissions summary",
                                subtitle: "What the source feed says this app expects at runtime."
                            )

                            if let ents = perms.entitlements, !ents.isEmpty {
                                VStack(spacing: 10) {
                                    ForEach(ents, id: \.self) { entitlement in
                                        Label(entitlement, systemImage: "lock.shield")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .sidelinkInsetPanel()
                                    }
                                }
                            }

                            if let privacy = perms.privacy, !privacy.isEmpty {
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

                    if !ipa.warnings.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Warnings",
                                title: "Things to review",
                                subtitle: "Signals detected while reading this IPA before install."
                            )

                            VStack(spacing: 10) {
                                ForEach(ipa.warnings, id: \.self) { warning in
                                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                                        .font(.footnote)
                                        .foregroundStyle(Color.slWarning)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(16)
                                        .background(Color.orange.opacity(colorScheme == .dark ? 0.16 : 0.10), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                                }
                            }
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }

                    Spacer(minLength: 96)
                }
                .padding(.vertical, 20)
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if model.isAtFreeSlotLimit && !isInstalled {
                    Label(
                        "Slot limit reached (\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots))",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.caption2)
                    .foregroundStyle(.orange)
                }
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
                        await model.startInstall(
                            ipaId: ipa.id,
                            appName: ipa.bundleName,
                            subtitle: "Installing from your library"
                        )
                    }
                } label: {
                    Label(installButtonLabel, systemImage: isInstalled ? "arrow.clockwise" : "arrow.down.app.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(.slAccent)
                .disabled(!model.canStartInstall)
                .accessibilityLabel(isInstalled ? "Reinstall app" : "Install app")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(colorScheme == .dark ? Color.black.opacity(0.88) : Color.white.opacity(0.82))
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Helpers
    private var matchingSourceApp: SourceAppDTO? {
        model.sourceCatalogs
            .flatMap { $0.manifest.apps }
            .first { $0.bundleIdentifier == ipa.bundleId }
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

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 16) {
                appIcon

                VStack(alignment: .leading, spacing: 6) {
                    SidelinkSectionIntro(
                        eyebrow: "Library",
                        title: ipa.bundleName,
                        subtitle: ipa.bundleId
                    )

                    if !heroSubtitle.isEmpty {
                        Text(heroSubtitle)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 12) {
                SidelinkMetricTile(label: "Version", value: ipa.bundleShortVersion)
                if let size = ipa.fileSize, size > 0 {
                    SidelinkMetricTile(label: "Size", value: formatFileSize(size), tint: .slAccent2)
                }
                if let minOS = ipa.minOsVersion, !minOS.isEmpty {
                    SidelinkMetricTile(label: "Min iOS", value: minOS, tint: .slWarning)
                }
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private var appIcon: some View {
        if let iconData = ipa.iconData,
           let data = Data(base64Encoded: iconData),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .appIconStyle(size: 80)
                .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.secondary.opacity(0.15))
                .frame(width: 80, height: 80)
                .overlay {
                    Image(systemName: "app.fill")
                        .font(.title)
                        .foregroundStyle(.secondary)
                }
        }
    }

    private func formatFileSize(_ bytes: Double) -> String {
        SidelinkFormatting.fileSize(bytes)
    }

    private var screenshotWidth: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 220 : 140
    }

    private var screenshotHeight: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 392 : 248
    }

    private func describeEntitlement(_ value: Any?) -> String {
        switch value {
        case let b as Bool: return b ? "true" : "false"
        case let s as String: return s
        case let a as [Any]: return "[\(a.count) items]"
        case let d as [String: Any]: return "{\(d.count) keys}"
        case let n as NSNumber: return n.stringValue
        default: return "–"
        }
    }
}

private struct DetailRow: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack {
            Label(label, systemImage: icon)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .multilineTextAlignment(.trailing)
        }
        .sidelinkInsetPanel()
    }
}
