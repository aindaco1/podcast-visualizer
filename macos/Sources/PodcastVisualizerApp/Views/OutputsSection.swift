import PodcastVisualizerCore
import SwiftUI

struct OutputsSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Outputs", systemImage: "rectangle.on.rectangle.angled") {
            Text("Aspect ratios").font(.subheadline.weight(.semibold))
            HStack(spacing: 18) {
                ForEach(RenderAspect.allCases, id: \.self) { aspect in
                    Toggle(aspect.label, isOn: aspectBinding(aspect))
                }
            }
            Text("Delivery profiles").font(.subheadline.weight(.semibold))
            HStack(spacing: 18) {
                ForEach(DeliveryProfile.allCases, id: \.self) { profile in
                    Toggle(profile.label, isOn: profileBinding(profile))
                }
            }
            if store.renderSelection.profiles.contains(.proResAlpha) {
                Label("ProRes 4444 is a large compatibility output. Confirm available storage before rendering.", systemImage: "externaldrive.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .accessibilityLabel("Storage warning: ProRes 4444 files are large")
            }
            Divider()
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Episode chapters").font(.subheadline.weight(.semibold))
                    Text("Generate grounded YouTube timestamps from the approved local alignment.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Open Chapters") { store.showChapters() }
                    .disabled(store.isRunning)
            }
            if store.isRenderingVideo {
                OperationProgressView(store: store)
            }
        }
    }

    private func aspectBinding(_ aspect: RenderAspect) -> Binding<Bool> {
        Binding {
            store.renderSelection.aspects.contains(aspect)
        } set: { selected in
            if selected { store.renderSelection.aspects.insert(aspect) }
            else { store.renderSelection.aspects.remove(aspect) }
        }
    }

    private func profileBinding(_ profile: DeliveryProfile) -> Binding<Bool> {
        Binding {
            store.renderSelection.profiles.contains(profile)
        } set: { selected in
            if selected { store.renderSelection.profiles.insert(profile) }
            else { store.renderSelection.profiles.remove(profile) }
        }
    }
}
