//! PDF download and local storage commands for the Tauri desktop app.
//!
//! Provides `download_pdf` which fetches a PDF from a URL and saves it to the
//! local references directory (~/.astro/references/pdfs/).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Result returned after a successful PDF download.
#[derive(Debug, Clone, Serialize)]
pub struct PdfDownloadResult {
    /// Absolute path where the PDF was saved.
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// Original URL the PDF was fetched from.
    pub source_url: String,
}

/// Metadata about a resolved open-access PDF.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfResolution {
    /// Direct URL to the PDF file.
    pub pdf_url: Option<String>,
    /// Whether the paper is open access.
    pub is_oa: bool,
    /// Source of the OA copy (e.g., "publisher", "repository").
    pub oa_source: Option<String>,
}

/// Return the default PDF storage directory: ~/.astro/references/pdfs/
fn default_pdf_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".astro").join("references").join("pdfs"))
}

/// Ensure a directory exists, creating it recursively if needed.
fn ensure_dir(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path)
            .map_err(|e| format!("Failed to create directory {}: {}", path.display(), e))?;
    }
    Ok(())
}

/// Sanitize a filename by removing/replacing unsafe characters.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

/// Download a PDF from a URL and save it to the specified destination path.
///
/// If `dest_path` is empty/null, defaults to ~/.astro/references/pdfs/<filename>.
/// The destination directory is created automatically if it doesn't exist.
///
/// # Arguments
/// * `url` - The URL to download the PDF from
/// * `dest_path` - Optional destination path. If empty, uses default directory with URL-derived filename.
///
/// # Returns
/// `PdfDownloadResult` with the saved path, file size, and source URL.
#[tauri::command]
pub async fn download_pdf(url: String, dest_path: String) -> Result<PdfDownloadResult, String> {
    // Determine the final save path
    let save_path = if dest_path.is_empty() {
        let dir = default_pdf_dir()?;
        ensure_dir(&dir)?;

        // Derive filename from URL
        let filename = url
            .rsplit('/')
            .next()
            .unwrap_or("download.pdf")
            .split('?')
            .next()
            .unwrap_or("download.pdf");

        let filename = sanitize_filename(filename);
        let filename = if filename.ends_with(".pdf") {
            filename
        } else {
            format!("{}.pdf", filename)
        };

        dir.join(&filename)
    } else {
        let p = PathBuf::from(&dest_path);
        if let Some(parent) = p.parent() {
            ensure_dir(parent)?;
        }
        p
    };

    // Perform the HTTP download
    let client = reqwest::Client::builder()
        .user_agent("Astro-Desktop/0.1 (mailto:team@astroanywhere.com)")
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch PDF from {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} when fetching PDF from {}",
            response.status(),
            url
        ));
    }

    // Verify content type looks like a PDF (lenient — some servers misreport)
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.is_empty()
        && !content_type.contains("pdf")
        && !content_type.contains("octet-stream")
        && !content_type.contains("binary")
    {
        return Err(format!(
            "Response content-type '{}' doesn't look like a PDF",
            content_type
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read PDF response body: {}", e))?;

    // Basic PDF magic number check
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Downloaded content is not a valid PDF (missing %PDF- header)".to_string());
    }

    let size = bytes.len() as u64;

    // Write to disk
    fs::write(&save_path, &bytes)
        .map_err(|e| format!("Failed to write PDF to {}: {}", save_path.display(), e))?;

    Ok(PdfDownloadResult {
        path: save_path.to_string_lossy().to_string(),
        size,
        source_url: url,
    })
}

/// Resolve a DOI to an open-access PDF URL via the Unpaywall API.
///
/// Uses the Unpaywall API (api.unpaywall.org) which is free for non-commercial use.
/// Returns PDF URL and OA metadata if available.
#[tauri::command]
pub async fn resolve_doi_pdf(doi: String, email: String) -> Result<PdfResolution, String> {
    let client = reqwest::Client::builder()
        .user_agent("Astro-Desktop/0.1 (mailto:team@astroanywhere.com)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let api_url = format!(
        "https://api.unpaywall.org/v2/{}?email={}",
        doi,
        urlencoding::encode(&email)
    );

    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Unpaywall API request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(PdfResolution {
            pdf_url: None,
            is_oa: false,
            oa_source: None,
        });
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Unpaywall response: {}", e))?;

    let is_oa = json.get("is_oa").and_then(|v| v.as_bool()).unwrap_or(false);

    // Try best_oa_location first, then first oa_locations entry
    let pdf_url = json
        .get("best_oa_location")
        .and_then(|loc| loc.get("url_for_pdf"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            json.get("oa_locations")
                .and_then(|locs| locs.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find_map(|loc| loc.get("url_for_pdf").and_then(|v| v.as_str()))
                })
        })
        .map(String::from);

    let oa_source = json
        .get("best_oa_location")
        .and_then(|loc| loc.get("host_type"))
        .and_then(|v| v.as_str())
        .map(String::from);

    Ok(PdfResolution {
        pdf_url,
        is_oa,
        oa_source,
    })
}

/// Get the default references directory path.
#[tauri::command]
pub fn get_references_dir() -> Result<String, String> {
    let dir = default_pdf_dir()?;
    ensure_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

/// List all downloaded PDFs in the references directory.
#[tauri::command]
pub fn list_downloaded_pdfs() -> Result<Vec<PdfDownloadResult>, String> {
    let dir = default_pdf_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("pdf") {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            results.push(PdfDownloadResult {
                path: path.to_string_lossy().to_string(),
                size: metadata.len(),
                source_url: String::new(), // Unknown for already-downloaded files
            });
        }
    }

    results.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(results)
}

/// Delete a downloaded PDF by path.
#[tauri::command]
pub fn delete_downloaded_pdf(path: String) -> Result<(), String> {
    let p = Path::new(&path);

    // Safety: only allow deletion within the references directory
    let refs_dir = default_pdf_dir()?;
    if !p.starts_with(&refs_dir) {
        return Err("Cannot delete files outside the references directory".to_string());
    }

    if p.exists() {
        fs::remove_file(p).map_err(|e| format!("Failed to delete {}: {}", path, e))?;
    }
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("paper.pdf"), "paper.pdf");
        assert_eq!(sanitize_filename("my/paper:v2.pdf"), "my_paper_v2.pdf");
        assert_eq!(sanitize_filename("a*b?c<d>e|f.pdf"), "a_b_c_d_e_f.pdf");
    }

    #[test]
    fn test_default_pdf_dir() {
        let dir = default_pdf_dir();
        assert!(dir.is_ok());
        let dir = dir.unwrap();
        assert!(dir.to_string_lossy().contains(".astro"));
        assert!(dir.to_string_lossy().contains("pdfs"));
    }
}
