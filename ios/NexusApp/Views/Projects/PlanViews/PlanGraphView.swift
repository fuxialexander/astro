import SwiftUI

/// Simplified plan graph visualization using Canvas
/// Tap nodes to select, pinch to zoom
struct PlanGraphView: View {
    let projectId: String

    @Environment(PlanStore.self) private var planStore
    @State private var selectedNodeId: String?
    @State private var scale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private var nodes: [PlanNode] {
        planStore.nodes(for: projectId)
    }

    private var edges: [PlanEdge] {
        planStore.edges(for: projectId)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Background
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                // Graph content
                Canvas { context, size in
                    drawEdges(context: context, size: size)
                    drawNodes(context: context, size: size)
                }
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    SimultaneousGesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = max(0.3, min(3.0, value))
                            },
                        DragGesture()
                            .onChanged { value in
                                offset = CGSize(
                                    width: lastOffset.width + value.translation.width,
                                    height: lastOffset.height + value.translation.height
                                )
                            }
                            .onEnded { _ in
                                lastOffset = offset
                            }
                    )
                )

                // Overlay tappable hit areas for nodes
                ForEach(nodes) { node in
                    let pos = nodePosition(node, in: geo.size)
                    Circle()
                        .fill(.clear)
                        .frame(width: 60, height: 60)
                        .contentShape(Circle())
                        .position(
                            x: pos.x * scale + offset.width + geo.size.width / 2,
                            y: pos.y * scale + offset.height + geo.size.height / 2
                        )
                        .onTapGesture {
                            selectedNodeId = node.id
                        }
                }
            }
        }
        .sheet(item: Binding(
            get: { selectedNodeId.flatMap { id in nodes.first { $0.id == id } } },
            set: { selectedNodeId = $0?.id }
        )) { node in
            NavigationStack {
                TaskDetailView(nodeId: node.id, projectId: projectId)
            }
        }
    }

    // MARK: - Drawing

    private func drawEdges(context: GraphicsContext, size: CGSize) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let nodeMap = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })

        for edge in edges {
            guard let source = nodeMap[edge.source], let target = nodeMap[edge.target] else { continue }
            let from = CGPoint(
                x: center.x + CGFloat(source.position.x),
                y: center.y + CGFloat(source.position.y)
            )
            let to = CGPoint(
                x: center.x + CGFloat(target.position.x),
                y: center.y + CGFloat(target.position.y)
            )

            var path = Path()
            path.move(to: from)
            path.addLine(to: to)

            context.stroke(path, with: .color(.secondary.opacity(0.3)), lineWidth: 1)
        }
    }

    private func drawNodes(context: GraphicsContext, size: CGSize) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)

        for node in nodes {
            let pos = CGPoint(
                x: center.x + CGFloat(node.position.x),
                y: center.y + CGFloat(node.position.y)
            )

            let radius: CGFloat = node.type == .milestone ? 20 : 15
            let color = nodeColor(node)

            // Draw circle
            let rect = CGRect(x: pos.x - radius, y: pos.y - radius, width: radius * 2, height: radius * 2)
            context.fill(Path(ellipseIn: rect), with: .color(color.opacity(0.2)))
            context.stroke(Path(ellipseIn: rect), with: .color(color), lineWidth: selectedNodeId == node.id ? 3 : 1.5)

            // Draw title
            let text = Text(node.title).font(.system(size: 9)).foregroundColor(.primary)
            context.draw(text, at: CGPoint(x: pos.x, y: pos.y + radius + 10))
        }
    }

    private func nodePosition(_ node: PlanNode, in size: CGSize) -> CGPoint {
        CGPoint(x: CGFloat(node.position.x), y: CGFloat(node.position.y))
    }

    private func nodeColor(_ node: PlanNode) -> Color {
        switch node.status {
        case .completed, .autoVerified: return .green
        case .inProgress, .dispatched: return .blue
        case .awaitingJudgment: return .orange
        case .pruned: return .red
        case .planned: return .gray
        }
    }
}
