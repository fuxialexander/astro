use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

use ignore::WalkBuilder;


// ── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line: u32,
    pub text: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn modified_secs(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Parse the output of `git status --porcelain -b` into a GitStatus struct.
pub fn parse_git_status(output: &str) -> GitStatus {
    let mut staged: Vec<String> = Vec::new();
    let mut modified: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    let mut branch = String::from("HEAD");

    for line in output.lines() {
        // Branch header line: "## main...origin/main" or "## HEAD (no branch)"
        if let Some(rest) = line.strip_prefix("## ") {
            branch = rest
                .split("...")
                .next()
                .unwrap_or("HEAD")
                .to_string();
            continue;
        }

        if line.len() < 4 {
            continue;
        }

        let x = line.as_bytes()[0];
        let y = line.as_bytes()[1];
        let file = line[3..].to_string();

        // Untracked
        if x == b'?' && y == b'?' {
            untracked.push(file);
            continue;
        }

        // Index (staged) changes
        if x != b' ' && x != b'?' {
            staged.push(file.clone());
        }

        // Working tree (unstaged) changes
        if y != b' ' && y != b'?' {
            modified.push(file);
        }
    }

    GitStatus {
        staged,
        modified,
        untracked,
        branch,
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

/// List directory contents, optionally respecting .gitignore.
#[tauri::command]
pub fn list_files(path: &str, gitignore: bool) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();

    if gitignore {
        // Use the `ignore` crate which respects .gitignore by default
        let walker = WalkBuilder::new(root)
            .max_depth(Some(1))
            .hidden(false)
            .build();

        for result in walker {
            let entry = result.map_err(|e| e.to_string())?;
            // Skip the root directory itself
            if entry.path() == root {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            entries.push(FileEntry {
                name: entry
                    .file_name()
                    .to_string_lossy()
                    .to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: modified_secs(&metadata),
            });
        }
    } else {
        let read_dir = fs::read_dir(root).map_err(|e| e.to_string())?;
        for entry in read_dir {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            entries.push(FileEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: modified_secs(&metadata),
            });
        }
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Run `git ls-files` for fast tracked-file listing.
#[tauri::command]
pub fn git_ls_files(repo_path: &str) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["ls-files"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git ls-files: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git ls-files failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(files)
}

/// Run `git status --porcelain -b` and parse into structured data.
#[tauri::command]
pub fn git_status(repo_path: &str) -> Result<GitStatus, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain", "-b"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_status(&stdout))
}

/// Read file contents (text files).
#[tauri::command]
pub fn read_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("Failed to read file: {}", e))
}

/// Search file contents using `grep -rn` (or ripgrep if available).
/// Returns matching lines with context.
#[tauri::command]
pub fn search_files(
    path: &str,
    pattern: &str,
    file_glob: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    // Try ripgrep first (faster), fall back to grep
    let (cmd, args) = if Command::new("rg").arg("--version").output().is_ok() {
        let mut args = vec![
            "--no-heading".to_string(),
            "--line-number".to_string(),
            "--color=never".to_string(),
            "-B1".to_string(),
            "-A1".to_string(),
        ];
        if let Some(glob) = file_glob {
            args.push("-g".to_string());
            args.push(glob.to_string());
        }
        args.push(pattern.to_string());
        args.push(path.to_string());
        ("rg".to_string(), args)
    } else {
        let mut args = vec![
            "-rn".to_string(),
            "--color=never".to_string(),
            "-B1".to_string(),
            "-A1".to_string(),
        ];
        if let Some(glob) = file_glob {
            args.push(format!("--include={}", glob));
        }
        args.push(pattern.to_string());
        args.push(path.to_string());
        ("grep".to_string(), args)
    };

    let output = Command::new(&cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", cmd, e))?;

    // grep/rg exit code 1 means no matches (not an error)
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} failed: {}", cmd, stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let results = parse_search_output(&stdout, path);
    Ok(results)
}

/// Parse search output (ripgrep/grep with context) into SearchResult structs.
fn parse_search_output(output: &str, _base_path: &str) -> Vec<SearchResult> {
    let mut results: Vec<SearchResult> = Vec::new();

    // Group lines by blocks (separated by "--" in rg/grep context output)
    let blocks: Vec<&str> = output.split("\n--\n").collect();

    for block in blocks {
        let mut context_before: Vec<String> = Vec::new();
        let mut context_after: Vec<String> = Vec::new();
        let mut match_path = String::new();
        let mut match_line: u32 = 0;
        let mut match_text = String::new();
        let mut found_match = false;

        for line in block.lines() {
            if line.is_empty() {
                continue;
            }

            // Lines look like: "path:linenum:text" (match) or "path-linenum-text" (context)
            // Try to parse as match line first (colon-separated)
            if let Some((file, rest)) = split_first_colon(line) {
                if let Some((linenum_str, text)) = split_first_colon(rest) {
                    if let Ok(linenum) = linenum_str.parse::<u32>() {
                        if !found_match {
                            // Check if this is a context line (separator is '-') or match (':')
                            // In ripgrep: match = "file:num:text", context = "file-num-text"
                            // We check if the original line has the pattern file:num:text
                            let prefix = format!("{}:{}", file, linenum);
                            let is_match_line = line.starts_with(&format!("{}:", prefix));

                            if is_match_line || context_after.is_empty() {
                                if found_match {
                                    context_after.push(text.to_string());
                                } else {
                                    match_path = file.to_string();
                                    match_line = linenum;
                                    match_text = text.to_string();
                                    found_match = true;
                                }
                            } else {
                                context_before.push(text.to_string());
                            }
                        } else {
                            context_after.push(text.to_string());
                        }
                        continue;
                    }
                }
            }

            // Fallback: treat as context
            if found_match {
                context_after.push(line.to_string());
            } else {
                context_before.push(line.to_string());
            }
        }

        if found_match {
            results.push(SearchResult {
                path: match_path,
                line: match_line,
                text: match_text,
                context_before,
                context_after,
            });
        }
    }

    results
}

/// Split a string at the first colon.
fn split_first_colon(s: &str) -> Option<(&str, &str)> {
    let idx = s.find(':')?;
    Some((&s[..idx], &s[idx + 1..]))
}

/// Recursive directory tree with configurable depth.
#[tauri::command]
pub fn get_file_tree(root: &str, depth: u32) -> Result<FileTreeNode, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }

    build_tree(root_path, depth)
}

fn build_tree(path: &Path, depth: u32) -> Result<FileTreeNode, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let is_dir = path.is_dir();

    if !is_dir || depth == 0 {
        return Ok(FileTreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children: if is_dir { Some(Vec::new()) } else { None },
        });
    }

    let mut children: Vec<FileTreeNode> = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_path = entry.path();

        // Skip hidden directories like .git to avoid huge trees
        let child_name = entry.file_name().to_string_lossy().to_string();
        if child_name.starts_with('.') {
            continue;
        }

        children.push(build_tree(&child_path, depth - 1)?);
    }

    // Sort: directories first, then alphabetically
    children.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(FileTreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        children: Some(children),
    })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_git_status_basic() {
        let output = "## main...origin/main\nM  src/lib.rs\n M src/main.rs\nA  new_file.txt\n?? untracked.txt\n";

        let status = parse_git_status(output);

        assert_eq!(status.branch, "main");
        assert!(status.staged.contains(&"src/lib.rs".to_string()));
        assert!(status.staged.contains(&"new_file.txt".to_string()));
        assert!(status.modified.contains(&"src/main.rs".to_string()));
        assert!(status.untracked.contains(&"untracked.txt".to_string()));
    }

    #[test]
    fn test_parse_git_status_no_remote() {
        let output = "## feature-branch\nM  file.rs\n";

        let status = parse_git_status(output);
        assert_eq!(status.branch, "feature-branch");
        assert_eq!(status.staged.len(), 1);
    }

    #[test]
    fn test_parse_git_status_empty() {
        let output = "## main\n";
        let status = parse_git_status(output);
        assert_eq!(status.branch, "main");
        assert!(status.staged.is_empty());
        assert!(status.modified.is_empty());
        assert!(status.untracked.is_empty());
    }

    #[test]
    fn test_parse_git_status_both_staged_and_modified() {
        let output = "## dev\nMM both.rs\n";

        let status = parse_git_status(output);
        assert_eq!(status.branch, "dev");
        assert!(status.staged.contains(&"both.rs".to_string()));
        assert!(status.modified.contains(&"both.rs".to_string()));
    }

    #[test]
    fn test_parse_git_status_renamed() {
        let output = "## main\nR  old.rs -> new.rs\n";

        let status = parse_git_status(output);
        assert!(status.staged.contains(&"old.rs -> new.rs".to_string()));
    }

    #[test]
    fn test_parse_git_status_deleted() {
        let output = "## main\nD  deleted.rs\n D unstaged_delete.rs\n";

        let status = parse_git_status(output);
        assert!(status.staged.contains(&"deleted.rs".to_string()));
        assert!(status.modified.contains(&"unstaged_delete.rs".to_string()));
    }

    #[test]
    fn test_split_first_colon() {
        assert_eq!(split_first_colon("foo:bar:baz"), Some(("foo", "bar:baz")));
        assert_eq!(split_first_colon("no_colon"), None);
        assert_eq!(split_first_colon(":empty"), Some(("", "empty")));
    }

    #[test]
    fn test_read_file_nonexistent() {
        let result = read_file("/tmp/nonexistent_file_12345.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_files_nonexistent() {
        let result = list_files("/tmp/nonexistent_dir_12345", false);
        assert!(result.is_err());
    }
}
