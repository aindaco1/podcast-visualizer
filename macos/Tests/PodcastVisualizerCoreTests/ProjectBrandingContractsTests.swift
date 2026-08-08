import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Project branding contracts")
struct ProjectBrandingContractsTests {
    @Test("decodes the bounded project branding workspace")
    func workspace() throws {
        let saved = try TestSupport.decodeFixture(
            "branding save",
            as: ProjectBrandingWorkspace.self
        )
        #expect(saved.podcastName == "The Local Show")
        #expect(saved.organizationName == "Acme Media")
        #expect(saved.showSpeakerNames)
        #expect(saved.logo?.width == 1_024)
    }

    @Test("normalizes project names and encodes exact logo actions")
    func editing() throws {
        #expect(ProjectBrandingEditing.normalizedName("  The Local Show  ") == "The Local Show")
        #expect(ProjectBrandingEditing.normalizedName("\n") == nil)
        #expect(ProjectBrandingEditing.normalizedName(String(repeating: "a", count: 121)) == nil)

        let payload = ProjectBrandingEditPayload(
            podcastName: "The Local Show",
            organizationName: "Acme Media",
            showSpeakerNames: true,
            logoAction: ProjectBrandingLogoAction(action: "keep")
        )
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        let action = object["logoAction"] as! [String: Any]
        #expect(action["action"] as? String == "keep")
        #expect(action["sourcePath"] == nil)
    }
}
