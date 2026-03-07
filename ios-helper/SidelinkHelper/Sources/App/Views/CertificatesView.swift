import SwiftUI

struct CertificatesView: View {
    @ObservedObject var model: HelperViewModel
    @State private var searchText = ""

    private var healthyCount: Int {
        filteredCertificates.filter { expiryHealth($0.expiresAt) == .healthy }.count
    }

    private var expiringCount: Int {
        filteredCertificates.filter { expiryHealth($0.expiresAt) == .expiring }.count
    }

    private var expiredCount: Int {
        filteredCertificates.filter { expiryHealth($0.expiresAt) == .expired }.count
    }

    private var filteredCertificates: [HelperCertificateDTO] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return model.certificates }
        return model.certificates.filter {
            $0.commonName.lowercased().contains(query)
            || $0.serialNumber.lowercased().contains(query)
            || ($0.accountAppleId?.lowercased().contains(query) ?? false)
        }
    }

    var body: some View {
        ZStack {
            SidelinkBackdrop(accent: .slWarning)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 18) {
                        SidelinkSectionIntro(
                            eyebrow: "Signing",
                            title: "Certificates",
                            subtitle: "Track certificate health and expiry without dropping back into a plain utility screen."
                        )

                        HStack(spacing: 12) {
                            SidelinkMetricTile(label: "Healthy", value: "\(healthyCount)", tint: .slSuccess)
                            SidelinkMetricTile(label: "Expiring", value: "\(expiringCount)", tint: .slWarning)
                            SidelinkMetricTile(label: "Expired", value: "\(expiredCount)", tint: .slDanger)
                        }
                    }
                    .liquidPanel()

                    if filteredCertificates.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.shield")
                                .font(.system(size: 36))
                                .foregroundStyle(.secondary)
                            Text(searchText.isEmpty ? "No Certificates" : "No matching certificates")
                                .font(.headline)
                            Text(searchText.isEmpty
                                 ? "Certificates are created automatically when you sign in with an Apple ID."
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
                            ForEach(filteredCertificates) { cert in
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(cert.commonName)
                                                .font(.subheadline.bold())
                                            Text(cert.serialNumber)
                                                .font(.caption.monospaced())
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        expiryBadge(for: cert.expiresAt)
                                    }

                                    HStack(spacing: 14) {
                                        if let appleId = cert.accountAppleId {
                                            Label(appleId, systemImage: "person.circle")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Label(SidelinkDateFormatting.formattedDate(cert.expiresAt), systemImage: "calendar")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
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
        .searchable(text: $searchText, prompt: "Search certificates")
        .refreshable { await model.loadCertificates() }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Certificates")
                    .font(.headline.weight(.semibold))
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.loadCertificates() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .task { await model.loadCertificates() }
    }

    // MARK: - Helpers

    private enum ExpiryHealth { case healthy, expiring, expired }

    private func expiryHealth(_ iso: String) -> ExpiryHealth {
        guard let date = SidelinkDateFormatting.parse(iso) else { return .expired }
        let remaining = date.timeIntervalSinceNow / 86_400
        if remaining <= 0 { return .expired }
        if remaining <= 7 { return .expiring }
        return .healthy
    }

    @ViewBuilder
    private func expiryBadge(for iso: String) -> some View {
        switch expiryHealth(iso) {
        case .healthy:
            PillBadge(text: "Valid", color: .slSuccess, small: true)
        case .expiring:
            PillBadge(text: "Expiring", color: .slWarning, small: true)
        case .expired:
            PillBadge(text: "Expired", color: .slDanger, small: true)
        }
    }

}