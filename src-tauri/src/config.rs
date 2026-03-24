use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// App configuration stored at ~/.astro/tauri-config.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// URL of the remote Astro server (e.g., "https://api.astroanywhere.com")
    #[serde(default)]
    pub server_url: Option<String>,

    /// API key for authenticating with the remote server
    #[serde(default)]
    pub api_key: Option<String>,

    /// Team ID to use when connecting to the remote server
    #[serde(default)]
    pub team_id: Option<String>,

    /// Port for the local sidecar backend (default: 3001)
    #[serde(default = "default_sidecar_port")]
    pub sidecar_port: u16,

    /// Port for the local WebSocket relay (default: 3002)
    #[serde(default = "default_relay_port")]
    pub relay_port: u16,
}

fn default_sidecar_port() -> u16 {
    3001
}

fn default_relay_port() -> u16 {
    3002
}

fn config_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".astro").join("tauri-config.json")
}

/// Read the app configuration from ~/.astro/tauri-config.json
#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    let path = config_path();

    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config at {}: {}", path.display(), e))?;

    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse config: {}", e))
}

/// Write the app configuration to ~/.astro/tauri-config.json
#[tauri::command]
pub fn set_app_config(config: AppConfig) -> Result<(), String> {
    let path = config_path();

    // Ensure ~/.astro directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write config at {}: {}", path.display(), e))?;

    Ok(())
}

/// Get environment variables to pass to the sidecar based on the current config.
/// Returns a list of (key, value) pairs.
#[tauri::command]
pub fn get_sidecar_env(config: AppConfig) -> Vec<(String, String)> {
    let mut env = Vec::new();

    // Always set local mode defaults
    env.push(("PORT".to_string(), config.sidecar_port.to_string()));
    env.push(("RELAY_PORT".to_string(), config.relay_port.to_string()));

    if let Some(ref server_url) = config.server_url {
        // Remote mode: connect to external Astro server
        env.push(("ASTRO_SERVER_URL".to_string(), server_url.clone()));

        if let Some(ref api_key) = config.api_key {
            env.push(("ASTRO_API_KEY".to_string(), api_key.clone()));
        }

        if let Some(ref team_id) = config.team_id {
            env.push(("ASTRO_TEAM_ID".to_string(), team_id.clone()));
        }
    } else {
        // Local mode: use PGlite
        env.push(("APP_MODE".to_string(), "local".to_string()));
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.sidecar_port, 0); // Default::default for u16 is 0
        assert!(config.server_url.is_none());
    }

    #[test]
    fn test_serde_roundtrip() {
        let config = AppConfig {
            server_url: Some("https://api.astroanywhere.com".to_string()),
            api_key: Some("sk-test-123".to_string()),
            team_id: Some("team-abc".to_string()),
            sidecar_port: 3001,
            relay_port: 3002,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.server_url, config.server_url);
        assert_eq!(parsed.api_key, config.api_key);
        assert_eq!(parsed.team_id, config.team_id);
        assert_eq!(parsed.sidecar_port, config.sidecar_port);
    }
}
