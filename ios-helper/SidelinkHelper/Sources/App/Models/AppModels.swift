import Foundation

typealias IPAAppModel = IpaArtifactDTO
typealias InstalledAppModel = InstallCardDTO
typealias SourceModel = SourceManifestDTO

struct DiscoveredBackend: Identifiable, Equatable {
	let id: String
	var name: String
	var url: String
	var lastSeenAt: Date
}

struct SourceCatalog: Identifiable {
	let sourceURL: String
	let manifest: SourceManifestDTO

	var id: String { sourceURL }
}
