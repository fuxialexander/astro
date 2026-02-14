import Foundation

struct UserProfile: Codable, Identifiable {
    let id: String
    var name: String
    var email: String
    var avatarUrl: String?
    var bio: String?
    var domains: [DomainExpertise]
    var experienceLevel: ExperienceLevel
    var preferredEnvironments: [TaskEnvironment]
    var notificationsEnabled: Bool
    var emailNotifications: Bool
    var apiKeys: [ApiKey]
    var createdAt: Date
    var updatedAt: Date

    enum DomainExpertise: String, Codable, CaseIterable {
        case computationalBiology = "computational-biology"
        case webDevelopment = "web-development"
        case dataEngineering = "data-engineering"
        case mlAi = "ml-ai"
        case devopsInfrastructure = "devops-infrastructure"
        case mobileDevelopment = "mobile-development"
        case systemsProgramming = "systems-programming"
        case scientificComputing = "scientific-computing"
        case security
        case other

        var displayName: String {
            switch self {
            case .computationalBiology: return "Computational Biology"
            case .webDevelopment: return "Web Development"
            case .dataEngineering: return "Data Engineering"
            case .mlAi: return "ML / AI"
            case .devopsInfrastructure: return "DevOps & Infrastructure"
            case .mobileDevelopment: return "Mobile Development"
            case .systemsProgramming: return "Systems Programming"
            case .scientificComputing: return "Scientific Computing"
            case .security: return "Security"
            case .other: return "Other"
            }
        }
    }

    enum ExperienceLevel: String, Codable, CaseIterable {
        case beginner, intermediate, advanced, expert
    }

    struct ApiKey: Codable, Identifiable {
        let id: String
        var provider: String
        var name: String
        var maskedKey: String
        var createdAt: Date
    }
}
