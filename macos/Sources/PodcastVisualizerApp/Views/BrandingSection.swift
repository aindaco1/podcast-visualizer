import AppKit
import SwiftUI

struct BrandingSection: View {
    let store: AppStore

    private var branding: ProjectBrandingStore { store.projectBranding }

    var body: some View {
        SectionCard(title: "Podcast Branding", systemImage: "paintbrush.pointed") {
            LabeledContent("Podcast name") {
                TextField("Podcast name", text: Bindable(branding).podcastName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 420)
            }
            LabeledContent("Organization") {
                TextField("Organization name", text: Bindable(branding).organizationName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 420)
            }
            Toggle("Show the speaker name on every transcript cue", isOn: Bindable(branding).showSpeakerNames)

            Divider()

            HStack(alignment: .top, spacing: 16) {
                Group {
                    if let url = branding.logoPreviewURL,
                       let image = NSImage(contentsOf: url) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .accessibilityLabel("Podcast logo preview")
                    } else {
                        VStack(spacing: 6) {
                            Image(systemName: "photo")
                                .font(.title2)
                            Text("No Logo").font(.caption)
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 128, height: 128)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 8) {
                    Text("Podcast logo").font(.subheadline.weight(.semibold))
                    Text("Recommended: square 1024 × 1024 PNG. Accepted: 128–4096 px, up to 10 MiB. Saving branding copies the logo into the project, so the original is no longer required afterward.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let size = branding.logoPixelSize {
                        Text("Selected: \(Int(size.width)) × \(Int(size.height)) px")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Button("Choose Logo…") { store.choosePodcastLogo() }
                            .disabled(store.isRunning)
                        Button("Remove Logo", role: .destructive) { store.removePodcastLogo() }
                            .disabled(!branding.hasLogo || store.isRunning)
                    }
                }
            }

            HStack {
                Text(branding.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Save Branding") { store.saveProjectBranding() }
                    .disabled(
                        store.state.projectURL == nil || !branding.canSave || store.isRunning
                    )
            }
        }
    }
}
