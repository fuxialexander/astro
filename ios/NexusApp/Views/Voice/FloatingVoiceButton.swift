import SwiftUI

struct FloatingVoiceButton: View {
    @Binding var showVoiceChat: Bool
    @Environment(SpeechRecognizer.self) private var speechRecognizer

    var body: some View {
        Button {
            showVoiceChat = true
        } label: {
            ZStack {
                Circle()
                    .fill(.tint)
                    .frame(width: 56, height: 56)
                    .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
                    .glow(color: .nexusBlue, radius: 12)

                if speechRecognizer.isRecording {
                    // Pulsing ring when recording
                    Circle()
                        .stroke(.tint.opacity(0.4), lineWidth: 3)
                        .frame(width: 68, height: 68)
                        .modifier(PulseModifier())

                    Image(systemName: "waveform")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)
                        .contentTransition(.symbolEffect(.replace))
                } else {
                    Image(systemName: "mic")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Voice assistant")
    }
}

private struct PulseModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPulsing ? 1.15 : 1.0)
            .opacity(isPulsing ? 0.0 : 1.0)
            .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false), value: isPulsing)
            .onAppear { isPulsing = true }
    }
}
