/**
 * File type detection utilities for file preview
 */

export type FileCategory = "image" | "pdf" | "code" | "markdown" | "download-only"

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg",
])

const PDF_EXTENSIONS = new Set(["pdf"])

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"])

const CODE_EXTENSIONS = new Set([
  // Programming languages
  "py", "ts", "tsx", "js", "jsx", "go", "rs", "rb", "java", "c", "cpp", "h", "hpp",
  "cs", "swift", "kt", "kts", "scala", "clj", "cljs", "hs", "ml", "ex", "exs",
  "r", "R", "jl", "lua", "php", "pl", "pm", "dart", "zig", "nim", "v", "odin",
  // Web / markup
  "html", "htm", "css", "scss", "sass", "less", "xml", "xsl", "xslt", "svg",
  "vue", "svelte", "astro",
  // Config / data
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "env", "properties", "gradle",
  // Shell / scripting
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  // Build / package
  "dockerfile", "makefile", "cmake", "rake", "gemspec",
  // Docs / text
  "txt", "log", "tex", "latex", "bib", "rst", "adoc",
  // Data
  "csv", "tsv", "sql",
  // Misc
  "diff", "patch", "lock", "gitignore", "gitattributes", "editorconfig",
])

/**
 * Determine the preview category for a file based on its extension.
 */
export function getFileCategory(filename: string): FileCategory {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  // Also handle extensionless known names
  const baseName = filename.split("/").pop()?.toLowerCase() ?? ""

  if (IMAGE_EXTENSIONS.has(ext)) return "image"
  if (PDF_EXTENSIONS.has(ext)) return "pdf"
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown"
  if (CODE_EXTENSIONS.has(ext)) return "code"

  // Handle known extensionless files as code
  const knownCodeFiles = new Set([
    "dockerfile", "makefile", "rakefile", "gemfile", "procfile",
    "vagrantfile", "jenkinsfile", ".gitignore", ".gitattributes",
    ".editorconfig", ".prettierrc", ".eslintrc", ".babelrc",
  ])
  if (knownCodeFiles.has(baseName)) return "code"

  return "download-only"
}

/**
 * Map file extension to Monaco language ID for syntax highlighting.
 */
export function getLanguageFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const baseName = filename.split("/").pop()?.toLowerCase() ?? ""

  const langMap: Record<string, string> = {
    py: "python",
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    json: "json", jsonc: "json", json5: "json",
    yaml: "yaml", yml: "yaml",
    toml: "toml",
    html: "html", htm: "html",
    css: "css", scss: "scss", sass: "scss", less: "less",
    xml: "xml", xsl: "xml", xslt: "xml", svg: "xml",
    sql: "sql",
    sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
    ps1: "powershell", psm1: "powershell",
    go: "go",
    rs: "rust",
    rb: "ruby",
    java: "java",
    c: "c", h: "c",
    cpp: "cpp", hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    kt: "kotlin", kts: "kotlin",
    scala: "scala",
    r: "r", R: "r",
    lua: "lua",
    php: "php",
    pl: "perl", pm: "perl",
    dart: "dart",
    md: "markdown", mdx: "markdown",
    tex: "latex", latex: "latex",
    diff: "diff", patch: "diff",
    ini: "ini", cfg: "ini", conf: "ini",
    dockerfile: "dockerfile",
    makefile: "makefile",
    txt: "plaintext",
    log: "plaintext",
    csv: "plaintext",
    tsv: "plaintext",
    env: "plaintext",
  }

  return langMap[ext] || langMap[baseName] || "plaintext"
}

/**
 * Build the content API URL for a file.
 */
export function buildContentUrl(machineId: string, filePath: string, download = false): string {
  const params = new URLSearchParams({ machineId, path: filePath })
  if (download) params.set("download", "true")
  return `/api/fs/content?${params.toString()}`
}
