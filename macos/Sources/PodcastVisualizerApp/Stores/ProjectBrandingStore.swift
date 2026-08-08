import AppKit
import Foundation
import Observation
import PodcastVisualizerCore

@MainActor
@Observable
final class ProjectBrandingStore {
    private(set) var workspace: ProjectBrandingWorkspace?
    var podcastName = "Dust Wave Podcast" { didSet { markChanged() } }
    var organizationName = "Dust Wave" { didSet { markChanged() } }
    var showSpeakerNames = true { didSet { markChanged() } }
    private(set) var pendingLogoURL: URL?
    private(set) var logoRemoved = false
    private(set) var isDirty = false
    private(set) var logoPixelSize: CGSize?
    var statusMessage = "Branding will be saved with the project"
    private var isApplying = false

    var logoPreviewURL: URL? {
        if logoRemoved { return nil }
        return pendingLogoURL ?? workspace?.logo.map { URL(fileURLWithPath: $0.path) }
    }

    var hasLogo: Bool { logoPreviewURL != nil }

    var canSave: Bool {
        isDirty
            && ProjectBrandingEditing.normalizedName(podcastName) != nil
            && ProjectBrandingEditing.normalizedName(organizationName) != nil
    }

    var editPayload: ProjectBrandingEditPayload? {
        guard let podcastName = ProjectBrandingEditing.normalizedName(podcastName),
              let organizationName = ProjectBrandingEditing.normalizedName(organizationName)
        else { return nil }
        let action: ProjectBrandingLogoAction
        if let pendingLogoURL {
            action = ProjectBrandingLogoAction(action: "replace", sourcePath: pendingLogoURL.path)
        } else if logoRemoved {
            action = ProjectBrandingLogoAction(action: "remove")
        } else {
            action = ProjectBrandingLogoAction(action: "keep")
        }
        return ProjectBrandingEditPayload(
            podcastName: podcastName,
            organizationName: organizationName,
            showSpeakerNames: showSpeakerNames,
            logoAction: action
        )
    }

    func load(_ workspace: ProjectBrandingWorkspace) {
        isApplying = true
        self.workspace = workspace
        podcastName = workspace.podcastName
        organizationName = workspace.organizationName
        showSpeakerNames = workspace.showSpeakerNames
        pendingLogoURL = nil
        logoRemoved = false
        logoPixelSize = workspace.logo.map { CGSize(width: $0.width, height: $0.height) }
        isDirty = false
        statusMessage = workspace.hasSavedSettings ? "Project branding loaded" : "Using default project branding"
        isApplying = false
    }

    func resetForNewProject() {
        isApplying = true
        workspace = nil
        podcastName = "Dust Wave Podcast"
        organizationName = "Dust Wave"
        showSpeakerNames = true
        pendingLogoURL = nil
        logoRemoved = false
        logoPixelSize = nil
        isDirty = false
        statusMessage = "Branding will be saved with the project"
        isApplying = false
    }

    func selectLogo(_ url: URL) -> Bool {
        let standardized = url.standardizedFileURL
        guard standardized.pathExtension.lowercased() == "png",
              let image = NSImage(contentsOf: standardized),
              let representation = image.representations.max(by: {
                  $0.pixelsWide * $0.pixelsHigh < $1.pixelsWide * $1.pixelsHigh
              })
        else {
            statusMessage = "Choose a valid PNG logo"
            return false
        }
        let size = CGSize(width: representation.pixelsWide, height: representation.pixelsHigh)
        guard (128...4_096).contains(Int(size.width)), (128...4_096).contains(Int(size.height)) else {
            statusMessage = "Logo dimensions must be between 128 and 4096 pixels"
            return false
        }
        pendingLogoURL = standardized
        logoRemoved = false
        logoPixelSize = size
        isDirty = true
        statusMessage = "New logo selected; save branding to copy it into the project"
        return true
    }

    func removeLogo() {
        guard hasLogo else { return }
        pendingLogoURL = nil
        logoRemoved = true
        logoPixelSize = nil
        isDirty = true
        statusMessage = "Logo will be removed when branding is saved"
    }

    private func markChanged() {
        guard !isApplying else { return }
        isDirty = true
        statusMessage = "Unsaved branding changes"
    }
}
