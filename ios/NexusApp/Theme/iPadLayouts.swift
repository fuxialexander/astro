import SwiftUI

// Note: PlanNode type is defined in Models/PlanNode.swift
// These drag/drop modifiers are forward declarations for future implementation

// MARK: - iPad Layout System
// Adaptive layouts optimized for iPad screen sizes with three-column layouts,
// split views, and responsive grids based on horizontal size class

/// Detects device size class for layout adaptation
enum DeviceSizeClass {
    case iPhone
    case iPadCompact      // iPad in portrait or split view
    case iPadRegular      // iPad in landscape

    static func current(_ horizontalSizeClass: UserInterfaceSizeClass?) -> DeviceSizeClass {
        #if targetEnvironment(macCatalyst)
        return .iPadRegular
        #else
        if UIDevice.current.userInterfaceIdiom == .pad {
            return horizontalSizeClass == .regular ? .iPadRegular : .iPadCompact
        }
        return .iPhone
        #endif
    }
}

// MARK: - iPad Layout Constants

enum iPadLayout {
    // Sidebar widths
    static let sidebarWidth: CGFloat = 260
    static let inspectorWidth: CGFloat = 320
    static let inspectorWidthWide: CGFloat = 340
    static let agentListWidth: CGFloat = 340

    // Grid columns
    static let gridColumns2: [GridItem] = [
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16)
    ]

    static let gridColumns3: [GridItem] = [
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16)
    ]

    static let gridColumns4: [GridItem] = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    // Spacing
    static let containerSpacing: CGFloat = 0
    static let panelPadding: CGFloat = 24
    static let toolbarHeight: CGFloat = 52
    static let toolbarHeightLarge: CGFloat = 56

    // Adaptive grid columns based on size class
    static func adaptiveGridColumns(_ sizeClass: DeviceSizeClass, columnCount: Int = 2) -> [GridItem] {
        switch sizeClass {
        case .iPhone:
            return [GridItem(.flexible())]
        case .iPadCompact:
            return gridColumns2
        case .iPadRegular:
            return columnCount >= 3 ? gridColumns3 : gridColumns2
        }
    }
}

// MARK: - Three Column Layout Container

/// Three-column layout for iPad: Sidebar + Main Content + Inspector
struct ThreeColumnLayout<Sidebar: View, Content: View, Inspector: View>: View {
    let sidebar: Sidebar
    let content: Content
    let inspector: Inspector?
    let inspectorWidth: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    init(
        inspectorWidth: CGFloat = iPadLayout.inspectorWidth,
        @ViewBuilder sidebar: () -> Sidebar,
        @ViewBuilder content: () -> Content,
        @ViewBuilder inspector: () -> Inspector? = { nil as Inspector? }
    ) {
        self.sidebar = sidebar()
        self.content = content()
        self.inspector = inspector()
        self.inspectorWidth = inspectorWidth
    }

    var body: some View {
        HStack(spacing: iPadLayout.containerSpacing) {
            // Sidebar (left)
            sidebar
                .frame(width: iPadLayout.sidebarWidth)

            Divider()

            // Main content (center)
            content
                .frame(maxWidth: .infinity)

            // Inspector (right) - conditional
            if let inspector = inspector {
                Divider()

                inspector
                    .frame(width: inspectorWidth)
                    .transition(.move(edge: .trailing))
            }
        }
        .background(AdaptiveColors.background(colorScheme))
    }
}

// MARK: - Two Column Layout Container

/// Two-column layout for iPad: Sidebar + Main Content
struct TwoColumnLayout<Sidebar: View, Content: View>: View {
    let sidebar: Sidebar
    let content: Content
    let sidebarWidth: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    init(
        sidebarWidth: CGFloat = iPadLayout.sidebarWidth,
        @ViewBuilder sidebar: () -> Sidebar,
        @ViewBuilder content: () -> Content
    ) {
        self.sidebar = sidebar()
        self.content = content()
        self.sidebarWidth = sidebarWidth
    }

    var body: some View {
        HStack(spacing: iPadLayout.containerSpacing) {
            // Sidebar
            sidebar
                .frame(width: sidebarWidth)

            Divider()

            // Main content
            content
                .frame(maxWidth: .infinity)
        }
        .background(AdaptiveColors.background(colorScheme))
    }
}

// MARK: - Split View Container

/// Split view container with resizable divider (master-detail pattern)
struct SplitViewContainer<Master: View, Detail: View>: View {
    let master: Master
    let detail: Detail?
    let defaultMasterWidth: CGFloat

    @State private var masterWidth: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    init(
        defaultMasterWidth: CGFloat = 340,
        @ViewBuilder master: () -> Master,
        @ViewBuilder detail: () -> Detail?
    ) {
        self.master = master()
        self.detail = detail()
        self.defaultMasterWidth = defaultMasterWidth
        self._masterWidth = State(initialValue: defaultMasterWidth)
    }

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                // Master pane
                master
                    .frame(width: masterWidth)

                Divider()

                // Detail pane (if provided)
                if let detail = detail {
                    detail
                        .frame(maxWidth: .infinity)
                } else {
                    // Empty state when no detail selected
                    ContentUnavailableView(
                        "Select an Item",
                        systemImage: "sidebar.left",
                        description: Text("Choose an item from the sidebar to view details")
                    )
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .background(AdaptiveColors.background(colorScheme))
    }
}

// MARK: - Adaptive Grid Container

/// Responsive grid that adapts column count based on size class
struct AdaptiveGridContainer<Item: Identifiable, ItemView: View>: View {
    let items: [Item]
    let sizeClass: DeviceSizeClass
    let columnCount: Int
    let spacing: CGFloat
    let itemBuilder: (Item) -> ItemView

    @Environment(\.colorScheme) private var colorScheme

    init(
        items: [Item],
        sizeClass: DeviceSizeClass,
        columnCount: Int = 2,
        spacing: CGFloat = 16,
        @ViewBuilder itemBuilder: @escaping (Item) -> ItemView
    ) {
        self.items = items
        self.sizeClass = sizeClass
        self.columnCount = columnCount
        self.spacing = spacing
        self.itemBuilder = itemBuilder
    }

    var body: some View {
        ScrollView {
            LazyVGrid(
                columns: iPadLayout.adaptiveGridColumns(sizeClass, columnCount: columnCount),
                spacing: spacing
            ) {
                ForEach(items) { item in
                    itemBuilder(item)
                }
            }
            .padding(spacing)
        }
        .background(AdaptiveColors.background(colorScheme))
    }
}

// MARK: - Toolbar Components

/// iPad-optimized toolbar with left/center/right sections
struct iPadToolbar<Leading: View, Center: View, Trailing: View>: View {
    let leading: Leading
    let center: Center
    let trailing: Trailing
    let height: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    init(
        height: CGFloat = iPadLayout.toolbarHeight,
        @ViewBuilder leading: () -> Leading = { EmptyView() },
        @ViewBuilder center: () -> Center = { EmptyView() },
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.leading = leading()
        self.center = center()
        self.trailing = trailing()
        self.height = height
    }

    var body: some View {
        HStack(spacing: 12) {
            leading

            Spacer()

            center

            Spacer()

            trailing
        }
        .padding(.horizontal, 20)
        .frame(height: height)
        .background(AdaptiveColors.surface(colorScheme))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

// MARK: - Inspector Panel

/// Right-side inspector panel with close button
struct InspectorPanel<Content: View>: View {
    let title: String
    let onClose: () -> Void
    let content: Content

    @Environment(\.colorScheme) private var colorScheme

    init(
        title: String,
        onClose: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.onClose = onClose
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(title)
                    .font(.headline)
                    .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(AdaptiveColors.surface(colorScheme))
            .overlay(alignment: .bottom) {
                Divider()
            }

            // Content
            ScrollView {
                content
                    .padding(iPadLayout.panelPadding)
            }
            .background(AdaptiveColors.surface(colorScheme))
        }
    }
}

// MARK: - List with Detail Panel Layout

/// List + detail panel layout (used for tasks, agents, etc.)
struct ListWithDetailLayout<ListItem: Identifiable, ListRow: View, DetailView: View>: View {
    let items: [ListItem]
    let selectedItem: ListItem?
    let onSelect: (ListItem) -> Void
    let onDeselect: () -> Void
    let listRowBuilder: (ListItem, Bool) -> ListRow
    let detailBuilder: (ListItem) -> DetailView
    let listTitle: String
    let emptyMessage: String

    @Environment(\.colorScheme) private var colorScheme

    init(
        items: [ListItem],
        selectedItem: ListItem?,
        listTitle: String,
        emptyMessage: String,
        onSelect: @escaping (ListItem) -> Void,
        onDeselect: @escaping () -> Void,
        @ViewBuilder listRowBuilder: @escaping (ListItem, Bool) -> ListRow,
        @ViewBuilder detailBuilder: @escaping (ListItem) -> DetailView
    ) {
        self.items = items
        self.selectedItem = selectedItem
        self.listTitle = listTitle
        self.emptyMessage = emptyMessage
        self.onSelect = onSelect
        self.onDeselect = onDeselect
        self.listRowBuilder = listRowBuilder
        self.detailBuilder = detailBuilder
    }

    var body: some View {
        HStack(spacing: 0) {
            // List
            VStack(spacing: 0) {
                // List header
                HStack {
                    Text(listTitle)
                        .font(.headline)
                        .foregroundColor(AdaptiveColors.textPrimary(colorScheme))

                    Spacer()

                    Text("\(items.count)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(AdaptiveColors.surface(colorScheme))
                .overlay(alignment: .bottom) {
                    Divider()
                }

                // List content
                if items.isEmpty {
                    ContentUnavailableView(emptyMessage, systemImage: "list.bullet")
                        .frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(items) { item in
                                listRowBuilder(item, selectedItem?.id == item.id)
                                    .onTapGesture {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            onSelect(item)
                                        }
                                    }
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .background(AdaptiveColors.background(colorScheme))

            // Detail panel (conditional)
            if let selected = selectedItem {
                Divider()

                InspectorPanel(title: listTitle, onClose: onDeselect) {
                    detailBuilder(selected)
                }
                .frame(width: iPadLayout.inspectorWidthWide)
                .transition(.move(edge: .trailing))
            }
        }
    }
}

// MARK: - View Extensions for iPad Adaptation

extension View {
    /// Adapts view layout based on horizontal size class
    func adaptiveLayout(
        _ horizontalSizeClass: UserInterfaceSizeClass?,
        iPhone: @escaping () -> some View,
        iPad: @escaping () -> some View
    ) -> some View {
        let sizeClass = DeviceSizeClass.current(horizontalSizeClass)

        return Group {
            if sizeClass == .iPhone {
                iPhone()
            } else {
                iPad()
            }
        }
    }

    /// Adaptive padding based on size class
    func adaptivePadding(_ sizeClass: DeviceSizeClass) -> some View {
        switch sizeClass {
        case .iPhone:
            return self.padding(NexusTheme.Spacing.md)
        case .iPadCompact:
            return self.padding(NexusTheme.Spacing.lg)
        case .iPadRegular:
            return self.padding(iPadLayout.panelPadding)
        }
    }

    /// Adaptive spacing for grids
    func adaptiveGridSpacing(_ sizeClass: DeviceSizeClass) -> CGFloat {
        switch sizeClass {
        case .iPhone:
            return 12
        case .iPadCompact:
            return 16
        case .iPadRegular:
            return 20
        }
    }
}

// MARK: - Drag and Drop Support Preparation

// Note: Drag and drop modifiers are commented out until PlanNode is available in this context.
// These will be implemented in view-specific files that have access to the PlanNode model.
//
// Example usage (to be added in view files):
//
// extension View {
//     func draggableNode(_ node: PlanNode) -> some View {
//         self.onDrag {
//             let nodeData = try? JSONEncoder().encode(node)
//             return NSItemProvider(item: nodeData as? NSSecureCoding, typeIdentifier: "com.nexus.plannode")
//         }
//     }
//
//     func dropTarget(onDrop: @escaping (PlanNode) -> Void) -> some View {
//         self.onDrop(of: ["com.nexus.plannode"], isTargeted: $isTargeted) { providers in
//             // Handle drop
//         }
//     }
// }
