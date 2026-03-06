import SwiftUI

struct CertificatesView: View {
    @ObservedObject var model: HelperViewModel
    @State private var searchText = ""

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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // MARK: - Summary
                HStack(spacing: 10) {
                    let healthy = filteredCertificates.filter { expiryHealth($0.expiresAt) == .healthy }.count
                    let warning = filteredCertificates.filter { expiryHealth($0.expiresAt) == .expiring }.count
                    let expired = filteredCertificates.filter { expiryHealth($0.expiresAt) == .expired }.count
                    statPill(title: "Healthy", value: "\(healthy)", color: .slSuccess)
                    statPill(title: "Expiring", value: "\(warning)", color: .slWarning)
                    statPill(title: "Expired", value: "\(expired)", color: .slDanger)
                }
                .sidelinkCard()

                // MARK: - Certificate cards
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
                    .sidelinkCard()
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredCertificates) { cert in
                            VStack(alignment: .leading, spacing: 10) {
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

                                Divider()

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
                            .sidelinkCard()
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Certificates")
        .searchable(text: $searchText, prompt: "Search certificates")
        .refreshable { await model.loadCertificates() }
        .toolbar {
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

    private func statPill(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}