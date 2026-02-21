# Overleaf and Zotero Integration Research

## Executive Summary

This document provides a feasibility assessment and integration architecture for connecting Astro with Overleaf (collaborative LaTeX editor) and Zotero (reference management) to support academic research workflows.

**Key Findings:**
- **Overleaf**: No official comprehensive REST API; requires workarounds via Git integration or unofficial APIs
- **Zotero**: Mature Web API v3 with full read/write capabilities and excellent documentation
- **Feasibility**: Zotero integration is production-ready; Overleaf integration requires Git-based approach or unofficial API usage

---

## Overleaf API Research

### Official API Status

Overleaf does **not** provide a comprehensive official REST API for programmatic access. The platform offers limited API capabilities:

#### Available Official Endpoints

1. **Project Creation/Import API**
   - **Endpoint**: `POST https://www.overleaf.com/docs`
   - **Purpose**: Create and open projects by importing files
   - **Parameters**:
     - `snip_uri`: URI of file to download and import
     - `engine`: TeX engine selection (pdflatex, xelatex, lualatex)
     - `main`: Main document filename
     - `rich_text`: Enable Visual Editor (boolean)
   - **Documentation**: [Overleaf API](https://www.overleaf.com/devs)

2. **Git Integration** (Primary Official Method)
   - **Protocol**: Git over HTTPS
   - **Authentication**: Token-based (up to 10 tokens per user)
   - **Endpoint Pattern**: `https://git.overleaf.com/<project-id>`
   - **Token Management**: Account Settings → Git Integration
   - **Capabilities**:
     - Clone projects as Git repositories
     - Push/pull changes
     - Branch management
     - Conflict resolution
   - **Limitations**:
     - Recommended: <100 files per commit
     - Recommended: <100 MB total project size
     - Rate limiting on frequent automated operations
   - **Documentation**: [Git Integration](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration)

### Unofficial API Solutions

Since Overleaf lacks a full REST API, the developer community has created reverse-engineered solutions:

#### 1. PyOverleaf (Python)

**Repository**: [jkulhanek/pyoverleaf](https://github.com/jkulhanek/pyoverleaf)

**Authentication**:
- Browser-based login flow (email + password)
- No official API tokens
- Session-based authentication

**Core API Methods**:

```python
from pyoverleaf import Api

# Authentication
api = Api()
api.login_from_browser()  # Opens browser for credential entry

# Project Management
projects = api.get_projects()  # List all projects
api.create_project(name)
api.delete_project(project_id)
api.archive_project(project_id)
api.rename_project(project_id, new_name)

# File Operations
files = api.project_get_files(project_id)
api.project_create_folder(project_id, parent_id, name)
api.project_upload_file(project_id, parent_id, file_name, file_content)
api.project_delete_entity(project_id, entity_id)

# Download
api.download_project(project_id)  # Downloads as zip
```

**Higher-Level IO Interface**:

```python
from pyoverleaf import ProjectIO

io = ProjectIO(api, project_id)
io.exists(path)
io.mkdir(path)
io.listdir(path)
with io.open(path, 'r') as f:
    content = f.read()
```

**CLI Commands**:
- `pyoverleaf download-project <project-id>`
- `pyoverleaf mkdir <project-id> <path>`
- `pyoverleaf read <project-id> <file>`
- `pyoverleaf write <project-id> <file> <content>`

**Limitations**:
- Unofficial API (may break with Overleaf updates)
- Requires credential storage
- Limited error handling
- No official support

#### 2. Overleaf-Workshop (VSCode Extension)

**Repository**: [overleaf-workshop/Overleaf-Workshop](https://github.com/overleaf-workshop/Overleaf-Workshop)

**Purpose**: VSCode integration with real-time collaboration
**Method**: Reverse-engineered internal WebSocket API
**Limitations**: Tightly coupled to VSCode environment

#### 3. Overleaf MCP Server

**Repository**: [GhoshSrinjoy/Overleaf-mcp](https://github.com/ghoshsrinjoy/overleaf-mcp)

**Method**: Uses Git integration to clone/sync projects
**Capabilities**:
- Parse .tex documents for sections
- Read file trees
- Git-based synchronization

### Rate Limits

**Git Integration**:
- Manual operations: Generally no rate limiting
- Automated polling: Can trigger rate limits
- Build operations: Occasional "Rate limit exceeded" errors (wait 60s and retry)
- **Recommendation**: Disable automated polling; reduce operation frequency

**Unofficial APIs**: Rate limits not documented (reverse-engineered)

### Collaboration Features

Overleaf provides web-based collaboration (not exposed via API):
- Real-time co-editing
- Track changes
- Commenting
- Collaborator chat
- History/version control

### Authentication

**Git Integration** (Official):
- Token-based authentication
- Tokens generated in Account Settings
- Maximum 10 active tokens per account
- Tokens passed via Git credentials

**Web Access** (Unofficial APIs):
- Email/password authentication
- Session cookies
- No OAuth support
- No official API keys for REST access

---

## Zotero API Research

### Official API: Web API v3

Zotero provides a **mature, well-documented REST API** with full read/write capabilities.

**Base URL**: `https://api.zotero.org`
**Documentation**: [Zotero Web API v3](https://www.zotero.org/support/dev/web_api/v3/basics)
**Current Version**: v3 (default and recommended)

### Authentication

#### API Keys

**Generation**:
1. Log in to [zotero.org](https://www.zotero.org)
2. Settings → Feeds/API
3. Create New Private Key
4. Select permissions (read/write access to library, notes, groups)

**Key Types**:
- **Personal library keys**: Access user's own library
- **Group library keys**: Access specific group libraries
- **Third-party app keys**: OAuth-issued keys

**Authentication Methods**:

```http
# Method 1: Custom Header (Recommended)
Zotero-API-Key: YOUR_API_KEY

# Method 2: Bearer Token
Authorization: Bearer YOUR_API_KEY

# Method 3: Query Parameter (Less secure)
?key=YOUR_API_KEY
```

**Access Levels**:
- **Public libraries**: No authentication required for read access
- **Private libraries**: Requires API key with appropriate permissions

#### OAuth Support

- **Current**: OAuth 1.0a supported
- **Future**: OAuth 2.0 planned (will use Bearer token method)
- **Recommendation**: Third-party apps should use OAuth to establish credentials

### Core API Endpoints

#### 1. Library Access

```http
# User library
GET /users/{userID}/items
GET /users/{userID}/collections

# Group library
GET /groups/{groupID}/items
GET /groups/{groupID}/collections
```

#### 2. Items (References)

```http
# List all items
GET /users/{userID}/items

# Get specific item
GET /users/{userID}/items/{itemKey}

# Create item
POST /users/{userID}/items
Content-Type: application/json
[
  {
    "itemType": "book",
    "title": "Example Title",
    "creators": [...]
  }
]

# Update item
PATCH /users/{userID}/items/{itemKey}

# Delete item
DELETE /users/{userID}/items/{itemKey}
```

#### 3. Collections

```http
# List collections
GET /users/{userID}/collections

# Get items in collection
GET /users/{userID}/collections/{collectionKey}/items

# Create collection
POST /users/{userID}/collections

# Update collection
PATCH /users/{userID}/collections/{collectionKey}
```

#### 4. Tags

```http
# List all tags
GET /users/{userID}/tags

# Items with specific tag
GET /users/{userID}/items?tag={tagName}
```

#### 5. Searches (Saved Searches)

```http
GET /users/{userID}/searches
```

#### 6. Bibliography Generation

```http
# Formatted bibliography (XHTML)
GET /users/{userID}/items?format=bib&style=chicago-author-date

# Individual formatted reference (JSON)
GET /users/{userID}/items/{itemKey}?include=bib&style=apa

# Supported formats
- format=json (default)
- format=atom
- format=bib (bibliography as XHTML)
- format=bibtex
- format=ris
- format=refer

# Citation styles (via style parameter)
- chicago-author-date
- apa
- mla
- nature
- science
- ... (1000+ CSL styles supported)
```

**Bibliography Limitations**:
- `format=bib`: Limited to **150 items** for performance
- For larger bibliographies: Fetch items individually with `include=bib`

#### 7. Full-Text Content

```http
# Item full-text content
GET /users/{userID}/items/{itemKey}/fulltext

# Search full-text
GET /users/{userID}/items?q={searchTerm}
```

#### 8. File Attachments

```http
# List file attachments
GET /users/{userID}/items?itemType=attachment

# Download file
GET /users/{userID}/items/{itemKey}/file

# Upload file attachment
POST /users/{userID}/items
# (Multi-step process: register upload, upload file, create item)
```

### Response Formats

**JSON** (default):
```json
{
  "key": "ABC123",
  "version": 123,
  "library": {...},
  "data": {
    "itemType": "journalArticle",
    "title": "Example Article",
    "creators": [...],
    "tags": [...]
  }
}
```

**Atom XML**: Standard Atom feed format

**BibTeX/RIS/Refer**: Citation export formats

### Rate Limits

**Backoff Mechanism**:
- Response header: `Backoff: {seconds}`
- Client should wait specified seconds before next request

**Hard Limits**:
- Response code: `429 Too Many Requests`
- Response header: `Retry-After: {seconds}`

**Best Practices**:
- No specific numeric limits published
- "Reasonable number of requests" is acceptable
- Always handle `Backoff` and `Retry-After` headers automatically
- Respect exponential backoff on errors

**Rate Limit Headers**:
```http
Backoff: 5          # Wait 5 seconds before next request
Retry-After: 60     # Hard limit: wait 60 seconds
```

### Versioning & Concurrency

**Versioning System**:
- Each item/collection has a `version` number
- Library has a global `version` number
- Use `If-Unmodified-Since-Version` header for optimistic locking

**Conflict Resolution**:
```http
# Conditional update (prevents overwriting newer changes)
PATCH /users/{userID}/items/{itemKey}
If-Unmodified-Since-Version: 123
```

**Sync Token**:
```http
# Get only items modified since version X
GET /users/{userID}/items?since=123
```

### Advanced Features

#### 1. Bulk Operations

```http
# Create/update up to 50 items per request
POST /users/{userID}/items
[
  { item1 },
  { item2 },
  ...
]
```

#### 2. Sorting & Filtering

```http
# Query parameters
?itemType=book
?tag=important
?q=search+term
?qmode=titleCreatorYear
?sort=title
?direction=asc
?limit=50
?start=0
```

#### 3. Subcollections

```http
# Collections support hierarchical structure
GET /users/{userID}/collections/{collectionKey}/collections
```

#### 4. Linked Items

Items can link to other items (e.g., notes attached to references)

### Client Libraries

**Official/Community**:
- **Pyzotero** (Python): [urschrei/pyzotero](https://github.com/urschrei/pyzotero)
  - Includes optional MCP server
  - Semantic Scholar integration
  - Full API coverage

**Example Usage**:
```python
from pyzotero import zotero

# Initialize
zot = zotero.Zotero(user_id, 'user', api_key)

# Fetch items
items = zot.items()
items = zot.collection_items('COLLECTION_KEY')

# Create item
template = zot.item_template('book')
template['title'] = 'Example'
zot.create_items([template])

# Search
results = zot.items(q='machine learning', qmode='everything')
```

### Integration with Overleaf

Overleaf has **built-in Zotero integration** (web-based):
- Link Zotero account to Overleaf
- Insert citations from Zotero library
- Uses Zotero's Web API

**Documentation**: [Zotero | Overleaf docs](https://docs.overleaf.com/integrations-and-add-ons/reference-manager-integrations/zotero)

---

## Feasibility Assessment

### Overleaf Integration

#### Challenges
❌ **No official REST API** for project management
❌ **Authentication**: Requires email/password (no API keys/OAuth for unofficial APIs)
❌ **Unofficial APIs**: Risk of breaking with platform updates
❌ **Rate limits**: Undocumented for Git operations; builds can hit limits
❌ **Collaboration API**: Real-time features not exposed

#### Viable Approaches

✅ **Git Integration** (Official, Recommended)
- **Pros**:
  - Official support
  - Token-based authentication
  - Reliable for sync operations
  - Works with existing Git tooling
- **Cons**:
  - Not a REST API
  - Requires Git client
  - Limited to file operations (no metadata API)
  - Rate limiting on frequent operations

✅ **PyOverleaf** (Unofficial, Community)
- **Pros**:
  - Full CRUD operations
  - Python-friendly
  - Active development
- **Cons**:
  - Unofficial/unsupported
  - May break without notice
  - Requires credential handling
  - No OAuth

✅ **Hybrid Approach** (Recommended for Production)
- Use **Git integration** for file sync (official, stable)
- Use **Overleaf MCP** pattern for read-only operations
- Avoid relying on unofficial write operations
- Focus on **one-way sync** (Astro → Overleaf via Git)

#### Risk Assessment
- **High**: Unofficial API breakage
- **Medium**: Rate limiting on automated operations
- **Low**: Git integration stability (official)

### Zotero Integration

#### Strengths
✅ **Mature, official REST API** with comprehensive documentation
✅ **OAuth 1.0a support** (OAuth 2.0 planned)
✅ **Flexible authentication** (API keys, Bearer tokens)
✅ **Full CRUD operations** on items, collections, tags
✅ **Bibliography generation** with 1000+ citation styles
✅ **Rate limiting** is reasonable and well-documented
✅ **Versioning system** for conflict resolution
✅ **Active ecosystem** (Pyzotero, official docs, community support)

#### Challenges
⚠️ **Bibliography limit**: 150 items per `format=bib` request
⚠️ **Rate limits**: Must implement backoff/retry logic
⚠️ **File attachments**: Multi-step upload process

#### Risk Assessment
- **Low**: API stability (official, versioned)
- **Low**: Breaking changes (versioned API with deprecation notices)
- **Low**: Rate limiting (reasonable limits, clear documentation)

---

## Proposed Integration Architecture

### Phase 1: Zotero Integration (High Priority)

#### Goal
Enable Astro users to:
1. Link Zotero accounts
2. Browse/search references
3. Insert citations into project documents
4. Generate bibliographies
5. Sync references to tasks/projects

#### Technical Design

**1. Authentication Flow**

```typescript
// Store in user profile
interface ZoteroCredentials {
  apiKey: string;
  userId: string;
  userName?: string;
  createdAt: Date;
}

// OAuth flow (recommended for production)
// 1. Redirect to Zotero OAuth
// 2. Receive callback with API key
// 3. Store encrypted in Supabase
```

**2. API Client**

```typescript
// server/lib/zotero-client.ts
class ZoteroClient {
  constructor(private apiKey: string, private userId: string) {}

  async getItems(params?: {
    collectionKey?: string;
    tag?: string;
    q?: string;
    limit?: number;
    sort?: 'title' | 'date';
  }): Promise<ZoteroItem[]> {
    // GET /users/{userId}/items
    // Handle rate limiting with exponential backoff
  }

  async getCollections(): Promise<ZoteroCollection[]> {
    // GET /users/{userId}/collections
  }

  async getBibliography(
    itemKeys: string[],
    style: string = 'chicago-author-date'
  ): Promise<string> {
    // Handle 150-item limit: batch if needed
    // GET /users/{userId}/items?format=bib&style={style}
  }

  async createItem(item: ZoteroItemTemplate): Promise<ZoteroItem> {
    // POST /users/{userId}/items
    // Handle version conflicts
  }

  async searchFullText(query: string): Promise<ZoteroItem[]> {
    // GET /users/{userId}/items?q={query}
  }
}
```

**3. MCP Tool Integration**

Add Zotero tools to Astro MCP server for agents:

```typescript
// server/lib/mcp/astro-tools-server.ts

// New tools:
{
  name: 'query_zotero_items',
  description: 'Search Zotero library for references',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      collection: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' }
    }
  }
}

{
  name: 'generate_bibliography',
  description: 'Generate formatted bibliography',
  inputSchema: {
    type: 'object',
    properties: {
      itemKeys: { type: 'array', items: { type: 'string' } },
      style: { type: 'string', default: 'chicago-author-date' }
    }
  }
}

{
  name: 'add_zotero_reference',
  description: 'Add reference to Zotero library',
  inputSchema: {
    type: 'object',
    properties: {
      itemType: { type: 'string' },
      title: { type: 'string' },
      creators: { type: 'array' },
      // ... other fields
    }
  }
}
```

**4. UI Components**

```typescript
// src/components/zotero/
- ZoteroSetupDialog.tsx      // API key configuration
- ZoteroLibraryBrowser.tsx   // Browse collections/items
- ZoteroSearchPanel.tsx      // Full-text search
- CitationInserter.tsx       // Insert citations into docs
- BibliographyGenerator.tsx  // Generate bibliographies
```

**5. Data Schema**

```sql
-- Supabase schema additions

CREATE TABLE zotero_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  api_key_encrypted TEXT NOT NULL,
  zotero_user_id TEXT NOT NULL,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE zotero_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  item_key TEXT NOT NULL,
  item_data JSONB NOT NULL,
  version INTEGER NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, item_key)
);

-- RLS policies
ALTER TABLE zotero_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own Zotero credentials"
  ON zotero_credentials FOR ALL
  USING (auth.uid() = user_id);
```

**6. Rate Limiting Implementation**

```typescript
// server/lib/zotero-rate-limiter.ts
class ZoteroRateLimiter {
  private backoffUntil: Date | null = null;

  async executeRequest<T>(
    requestFn: () => Promise<Response>
  ): Promise<T> {
    // Check if in backoff period
    if (this.backoffUntil && new Date() < this.backoffUntil) {
      const waitMs = this.backoffUntil.getTime() - Date.now();
      await sleep(waitMs);
    }

    const response = await requestFn();

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      this.backoffUntil = new Date(Date.now() + parseInt(retryAfter) * 1000);
      throw new RateLimitError(retryAfter);
    }

    // Handle backoff header
    const backoff = response.headers.get('Backoff');
    if (backoff) {
      this.backoffUntil = new Date(Date.now() + parseInt(backoff) * 1000);
    }

    return response.json();
  }
}
```

### Phase 2: Overleaf Integration (Medium Priority)

#### Goal
Enable Astro users to:
1. Link Overleaf projects to Astro projects
2. Sync LaTeX files bidirectionally
3. Trigger Overleaf builds from Astro
4. View compilation status

#### Technical Design

**Recommended Approach: Git Integration** (Official)

**1. Authentication**

```typescript
// Store Overleaf Git tokens
interface OverleafCredentials {
  gitToken: string; // Generated in Overleaf Account Settings
  projectId: string;
  projectName: string;
  gitUrl: string; // https://git.overleaf.com/{projectId}
}
```

**2. Git Client Wrapper**

```typescript
// server/lib/overleaf-git-client.ts
class OverleafGitClient {
  constructor(
    private projectId: string,
    private token: string,
    private workspaceDir: string
  ) {}

  async clone(): Promise<void> {
    // git clone https://{token}@git.overleaf.com/{projectId}
  }

  async pull(): Promise<GitPullResult> {
    // git pull origin master
    // Handle merge conflicts
  }

  async push(message: string): Promise<void> {
    // git add .
    // git commit -m "{message}"
    // git push origin master
    // Respect rate limits: batch commits
  }

  async getFileTree(): Promise<FileNode[]> {
    // git ls-tree -r HEAD
  }

  async readFile(path: string): Promise<string> {
    // Read from local clone
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Write to local clone
    // Stage for next commit
  }
}
```

**3. Sync Strategy**

```typescript
// One-way sync: Astro → Overleaf
// Triggered by:
// - Task completion (auto-sync results)
// - Manual user action
// - Scheduled interval

async function syncToOverleaf(
  projectId: string,
  files: Map<string, string>
): Promise<void> {
  const client = new OverleafGitClient(...);

  // Pull latest changes
  await client.pull();

  // Apply changes
  for (const [path, content] of files) {
    await client.writeFile(path, content);
  }

  // Commit and push (with rate limit check)
  await client.push(`Auto-sync from Astro: ${new Date().toISOString()}`);
}
```

**4. MCP Tools**

```typescript
// Agent tools for Overleaf integration
{
  name: 'sync_to_overleaf',
  description: 'Sync files to linked Overleaf project',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'object' }, // { path: content }
      commitMessage: { type: 'string' }
    }
  }
}

{
  name: 'get_overleaf_status',
  description: 'Check Overleaf project sync status',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' }
    }
  }
}
```

**5. Alternative: PyOverleaf Wrapper** (Fallback)

If Git integration is insufficient:

```typescript
// Use PyOverleaf via child process
import { spawn } from 'child_process';

class PyOverleafClient {
  async listProjects(): Promise<OverleafProject[]> {
    // Execute: pyoverleaf list-projects
    // Parse JSON output
  }

  async downloadProject(projectId: string): Promise<void> {
    // Execute: pyoverleaf download-project {projectId}
  }

  async uploadFile(projectId: string, path: string, content: string): Promise<void> {
    // Execute: pyoverleaf write {projectId} {path} {content}
  }
}
```

**Risks**: Unofficial API, credential management, breakage

### Phase 3: Combined Workflow (Academic Pipeline)

#### End-to-End Academic Research Flow

```
1. Create Astro project: "ML Research Paper"
2. Link Zotero library: "Machine Learning Papers 2026"
3. Link Overleaf project: "ML-Paper-Draft"
4. Plan tasks:
   - Literature review → Query Zotero, generate reading list
   - Run experiments → Execute on HPC
   - Generate figures → Process results
   - Write paper → Sync to Overleaf
   - Compile bibliography → Zotero API → BibTeX → Overleaf
5. Agent workflow:
   - Task: "Write introduction"
     - MCP tool: query_zotero_items(query="deep learning survey")
     - MCP tool: generate_bibliography(style="nature")
     - Write content to local .tex file
     - MCP tool: sync_to_overleaf(files={...})
   - Task: "Add experiment results"
     - Read task dependency outputs (figures, tables)
     - Update .tex with results
     - Sync to Overleaf
```

---

## Recommendations

### Immediate Actions (Week 1-2)

1. **Implement Zotero Integration**
   - ✅ Low risk, high value
   - ✅ Official API, well-documented
   - Create `ZoteroClient` class
   - Add MCP tools: `query_zotero_items`, `generate_bibliography`
   - Build UI: `ZoteroSetupDialog`, `ZoteroLibraryBrowser`

2. **Prototype Overleaf Git Integration**
   - ✅ Official method, stable
   - Create `OverleafGitClient` wrapper
   - Test clone/push/pull workflows
   - Document rate limit handling

### Short-term (Month 1)

3. **User Testing**
   - Deploy Zotero integration to beta users
   - Collect feedback on citation workflows
   - Validate Overleaf Git sync reliability

4. **Rate Limit Monitoring**
   - Implement telemetry for Zotero API usage
   - Track Overleaf Git operation frequency
   - Add backoff/retry logging

### Long-term (Month 2-3)

5. **Advanced Features**
   - Zotero full-text search
   - Collaborative annotation sync
   - Overleaf build status webhooks (if API becomes available)
   - Bibliography auto-update on reference changes

6. **Fallback Strategy**
   - Evaluate PyOverleaf for advanced use cases
   - Consider hosting custom Overleaf instance (open-source) for full API control
   - Monitor Overleaf roadmap for official API announcements

### Decision Points

**Overleaf API Approach**:
- **Option 1**: Git integration only (official, stable, limited features)
- **Option 2**: PyOverleaf wrapper (unofficial, full features, higher risk)
- **Option 3**: Hybrid (Git for sync, PyOverleaf for metadata)

**Recommendation**: Start with **Option 1** (Git integration) for production. Evaluate **Option 3** if user demand requires metadata access (project lists, collaboration info).

---

## References

### Overleaf
- [Overleaf API](https://www.overleaf.com/devs)
- [Git integration authentication tokens](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens)
- [GitHub - jkulhanek/pyoverleaf](https://github.com/jkulhanek/pyoverleaf)
- [GitHub - GhoshSrinjoy/Overleaf-mcp](https://github.com/GhoshSrinjoy/overleaf-mcp)
- [Project limits | On-premises](https://docs.overleaf.com/on-premises/support/project-limits)

### Zotero
- [Zotero Web API v3 Basics](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Using the Zotero API - Brown University Library](https://library.brown.edu/create/cds/zotero-api-web/)
- [GitHub - urschrei/pyzotero](https://github.com/urschrei/pyzotero)
- [Create a Zotero API key • c2z](https://oeysan.github.io/c2z/articles/zotero_api.html)
- [API rate limit - Zotero Forums](https://forums.zotero.org/discussion/60190/api-rate-limit)

### Integration
- [Zotero | Overleaf docs](https://docs.overleaf.com/integrations-and-add-ons/reference-manager-integrations/zotero)

---

## Appendix: API Examples

### Zotero API Examples

**Fetch items with tag**:
```bash
curl -H "Zotero-API-Key: YOUR_KEY" \
  "https://api.zotero.org/users/USER_ID/items?tag=machine-learning&limit=10"
```

**Generate Chicago-style bibliography**:
```bash
curl -H "Zotero-API-Key: YOUR_KEY" \
  "https://api.zotero.org/users/USER_ID/items?format=bib&style=chicago-author-date&tag=paper"
```

**Create new book item**:
```bash
curl -X POST \
  -H "Zotero-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '[{
    "itemType": "book",
    "title": "Deep Learning",
    "creators": [
      {"creatorType": "author", "firstName": "Ian", "lastName": "Goodfellow"}
    ],
    "date": "2016"
  }]' \
  "https://api.zotero.org/users/USER_ID/items"
```

### Overleaf Git Examples

**Clone project**:
```bash
git clone https://<TOKEN>@git.overleaf.com/<PROJECT_ID>
```

**Push changes**:
```bash
cd <PROJECT_ID>
# Make changes to .tex files
git add .
git commit -m "Update introduction section"
git push origin master
```

### PyOverleaf Examples

**List projects**:
```python
from pyoverleaf import Api

api = Api()
api.login_from_browser()
projects = api.get_projects()
for p in projects:
    print(f"{p['id']}: {p['name']}")
```

**Download project**:
```bash
pyoverleaf download-project abc123def456 -o ./my-paper
```

**Read file**:
```bash
pyoverleaf read abc123def456 main.tex
```
