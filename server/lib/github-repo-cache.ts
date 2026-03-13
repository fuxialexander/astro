import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  GitHubCachedIssue,
  GitHubCachedPr,
  GitHubRepoCacheSnapshot,
  GitHubWorkspaceAttentionItem,
  GitHubWorkspaceProjectSummary,
  GitHubWorkspaceSummary,
  Project,
} from '../../packages/core/src/types.js'
import { db } from './db/index.js'
import { githubIssueCache, githubPrCache, planNodes, projects } from './db/schema.js'
import { resolveGitHubToken } from './github-client.js'
import { fetchWithRateLimit } from './github-rate-limit.js'

const GITHUB_API = 'https://api.github.com'

type RepoProject = typeof projects.$inferSelect

type RawIssue = {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  html_url: string
  created_at: string
  updated_at: string
  closed_at: string | null
  comments: number
  user?: { login?: string } | null
  labels: Array<{ name: string; color?: string }>
  assignees: Array<{ login?: string }>
}

type RawPullRequest = {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  html_url: string
  created_at: string
  updated_at: string
  closed_at: string | null
  merged_at: string | null
  draft: boolean
  comments: number
  additions: number
  deletions: number
  changed_files: number
  mergeable: boolean | null
  user?: { login?: string } | null
  labels: Array<{ name: string; color?: string }>
  head?: { ref?: string; sha?: string } | null
  base?: { ref?: string } | null
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github.v3+json',
  }
}

async function fetchPaginated<T>(buildUrl: (page: number) => string, accessToken: string): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const response = await fetchWithRateLimit(buildUrl(page), {
      headers: githubHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GitHub API error ${response.status}: ${errorText}`)
    }

    const pageItems = await response.json() as T[]
    if (pageItems.length === 0) break
    results.push(...pageItems)
    if (pageItems.length < 100) break
    page += 1
  }

  return results
}

async function fetchIssues(accessToken: string, owner: string, repo: string): Promise<RawIssue[]> {
  const items = await fetchPaginated<Record<string, unknown>>(
    (page) => `${GITHUB_API}/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
    accessToken,
  )

  return items
    .filter((item) => !item.pull_request)
    .map((item) => ({
      number: item.number as number,
      title: item.title as string,
      body: (item.body as string | null) ?? null,
      state: ((item.state as string) === 'closed' ? 'closed' : 'open'),
      html_url: item.html_url as string,
      created_at: item.created_at as string,
      updated_at: item.updated_at as string,
      closed_at: (item.closed_at as string | null) ?? null,
      comments: (item.comments as number) ?? 0,
      user: item.user as RawIssue['user'],
      labels: ((item.labels as Array<Record<string, unknown>>) ?? []).map((label) => ({
        name: String(label.name ?? ''),
        color: typeof label.color === 'string' ? label.color : undefined,
      })),
      assignees: ((item.assignees as Array<Record<string, unknown>>) ?? []).map((assignee) => ({
        login: typeof assignee.login === 'string' ? assignee.login : undefined,
      })),
    }))
}

async function fetchPullRequests(accessToken: string, owner: string, repo: string): Promise<RawPullRequest[]> {
  const items = await fetchPaginated<Record<string, unknown>>(
    (page) => `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
    accessToken,
  )

  return items.map((item) => ({
    number: item.number as number,
    title: item.title as string,
    body: (item.body as string | null) ?? null,
    state: ((item.state as string) === 'closed' ? 'closed' : 'open'),
    html_url: item.html_url as string,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
    closed_at: (item.closed_at as string | null) ?? null,
    merged_at: (item.merged_at as string | null) ?? null,
    draft: Boolean(item.draft),
    comments: (item.comments as number) ?? 0,
    additions: (item.additions as number) ?? 0,
    deletions: (item.deletions as number) ?? 0,
    changed_files: (item.changed_files as number) ?? 0,
    mergeable: (item.mergeable as boolean | null) ?? null,
    user: item.user as RawPullRequest['user'],
    labels: ((item.labels as Array<Record<string, unknown>>) ?? []).map((label) => ({
      name: String(label.name ?? ''),
      color: typeof label.color === 'string' ? label.color : undefined,
    })),
    head: item.head as RawPullRequest['head'],
    base: item.base as RawPullRequest['base'],
  }))
}

async function fetchJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetchWithRateLimit(url, { headers: githubHeaders(accessToken) })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GitHub API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<Record<string, unknown>>
}

export function normalizeReviewDecision(value: string | null | undefined): GitHubCachedPr['reviewDecision'] {
  switch (value) {
    case 'approved':
    case 'changes_requested':
    case 'reviewed':
    case 'pending':
    case 'none':
      return value
    default:
      return 'none'
  }
}

export function normalizeMergeableState(value: boolean | null | undefined): GitHubCachedPr['mergeableState'] {
  if (value === true) return 'mergeable'
  if (value === false) return 'conflicting'
  return 'unknown'
}

export function normalizePullRequestState(pr: Pick<RawPullRequest, 'state' | 'merged_at'>): GitHubCachedPr['state'] {
  if (pr.merged_at) return 'merged'
  return pr.state === 'closed' ? 'closed' : 'open'
}

export function deriveAttentionItems(
  projectRows: GitHubWorkspaceProjectSummary[],
  prs: GitHubCachedPr[],
): GitHubWorkspaceAttentionItem[] {
  const items: GitHubWorkspaceAttentionItem[] = []
  const byProject = new Map(projectRows.map((project) => [project.projectId, project]))

  for (const pr of prs) {
    if (pr.state !== 'open') continue
    const project = byProject.get(pr.projectId)
    if (!project) continue

    let type: GitHubWorkspaceAttentionItem['type'] | null = null
    if (pr.ciStatus === 'failure') type = 'ci_failing'
    else if (pr.reviewDecision === 'changes_requested') type = 'changes_requested'
    else if (
      pr.ciStatus === 'success' &&
      pr.reviewDecision === 'approved' &&
      pr.mergeableState === 'mergeable'
    ) type = 'ready_to_merge'

    if (!type) continue

    items.push({
      type,
      projectId: pr.projectId,
      projectName: project.projectName,
      repo: project.repo,
      number: pr.prNumber,
      title: pr.title,
      url: pr.url,
      updatedAt: pr.updatedAt?.toISOString() ?? null,
    })
  }

  return items
}

async function fetchPrReviewDecision(accessToken: string, owner: string, repo: string, prNumber: number): Promise<GitHubCachedPr['reviewDecision']> {
  const reviews = await fetchPaginated<Record<string, unknown>>(
    (page) => `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${page}`,
    accessToken,
  )

  const latestByUser = new Map<string, string>()
  for (const review of reviews) {
    const state = String(review.state ?? '')
    const login = String((review.user as Record<string, unknown> | undefined)?.login ?? '')
    if (!login || state === 'PENDING' || state === 'COMMENTED') continue
    latestByUser.set(login, state)
  }

  const states = Array.from(latestByUser.values())
  if (states.length === 0) return 'none'
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested'
  if (states.every((state) => state === 'APPROVED')) return 'approved'
  return 'reviewed'
}

async function fetchPrCiStatus(accessToken: string, owner: string, repo: string, headSha: string | undefined): Promise<GitHubCachedPr['ciStatus']> {
  if (!headSha) return 'none'
  const checks = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}/commits/${headSha}/check-runs`, accessToken)
  const checkRuns = (checks.check_runs as Array<Record<string, unknown>> | undefined) ?? []
  if (checkRuns.length === 0) return 'none'

  const completed = checkRuns.filter((check) => check.status === 'completed')
  if (completed.some((check) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(String(check.conclusion ?? '')))) {
    return 'failure'
  }
  if (completed.length === checkRuns.length && completed.length > 0) return 'success'
  return 'pending'
}

async function enrichPullRequests(accessToken: string, owner: string, repo: string, pullRequests: RawPullRequest[]): Promise<GitHubCachedPr[]> {
  return Promise.all(
    pullRequests.map(async (pr) => {
      const detail = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pr.number}`, accessToken)
      const mergeable = (detail.mergeable as boolean | null) ?? pr.mergeable
      const additions = (detail.additions as number) ?? pr.additions
      const deletions = (detail.deletions as number) ?? pr.deletions
      const changedFiles = (detail.changed_files as number) ?? pr.changed_files
      const draft = Boolean(detail.draft ?? pr.draft)
      const mergedAt = (detail.merged_at as string | null) ?? pr.merged_at
      const closedAt = (detail.closed_at as string | null) ?? pr.closed_at
      const commentsCount = (detail.comments as number) ?? pr.comments
      const headSha = ((detail.head as Record<string, unknown> | null)?.sha as string | undefined) ?? pr.head?.sha

      const [reviewDecision, ciStatus] = await Promise.all([
        fetchPrReviewDecision(accessToken, owner, repo, pr.number),
        fetchPrCiStatus(accessToken, owner, repo, headSha),
      ])

      return {
        id: `${pr.number}`,
        projectId: '',
        prNumber: pr.number,
        title: pr.title,
        body: pr.body,
        state: normalizePullRequestState({ state: pr.state, merged_at: mergedAt }),
        url: pr.html_url,
        authorLogin: pr.user?.login ?? null,
        headBranch: pr.head?.ref ?? null,
        baseBranch: pr.base?.ref ?? null,
        labels: pr.labels,
        ciStatus,
        reviewDecision,
        mergeableState: normalizeMergeableState(mergeable),
        additions,
        deletions,
        changedFiles,
        commentsCount,
        draft,
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
        mergedAt: mergedAt ? new Date(mergedAt) : null,
        closedAt: closedAt ? new Date(closedAt) : null,
        cachedAt: new Date(),
      }
    }),
  )
}

function mapIssueToCache(projectId: string, issue: RawIssue): typeof githubIssueCache.$inferInsert {
  return {
    projectId,
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    url: issue.html_url,
    authorLogin: issue.user?.login ?? null,
    labels: issue.labels,
    assignees: issue.assignees.filter((assignee) => assignee.login).map((assignee) => ({ login: assignee.login! })),
    commentsCount: issue.comments,
    createdAt: issue.created_at ? new Date(issue.created_at) : null,
    updatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
    closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
    cachedAt: new Date(),
  }
}

function mapPrToCache(projectId: string, pr: GitHubCachedPr): typeof githubPrCache.$inferInsert {
  return {
    projectId,
    prNumber: pr.prNumber,
    title: pr.title,
    body: pr.body ?? null,
    state: pr.state,
    url: pr.url,
    authorLogin: pr.authorLogin ?? null,
    headBranch: pr.headBranch ?? null,
    baseBranch: pr.baseBranch ?? null,
    labels: pr.labels,
    ciStatus: pr.ciStatus ?? null,
    reviewDecision: pr.reviewDecision ?? null,
    mergeableState: pr.mergeableState ?? null,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commentsCount: pr.commentsCount,
    draft: pr.draft,
    createdAt: pr.createdAt ?? null,
    updatedAt: pr.updatedAt ?? null,
    mergedAt: pr.mergedAt ?? null,
    closedAt: pr.closedAt ?? null,
    cachedAt: new Date(),
  }
}

export async function upsertIssueCacheEntries(projectId: string, issues: RawIssue[]): Promise<void> {
  await db.delete(githubIssueCache).where(eq(githubIssueCache.projectId, projectId))
  if (issues.length === 0) return
  await db.insert(githubIssueCache).values(issues.map((issue) => mapIssueToCache(projectId, issue)))
}

export async function upsertPrCacheEntries(projectId: string, prs: GitHubCachedPr[]): Promise<void> {
  await db.delete(githubPrCache).where(eq(githubPrCache.projectId, projectId))
  if (prs.length === 0) return
  await db.insert(githubPrCache).values(prs.map((pr) => mapPrToCache(projectId, pr)))
}

export async function syncGitHubRepoCache(project: RepoProject, userId: string, teamId?: string | null): Promise<{ issueCount: number; prCount: number; syncedAt: string }> {
  if (project.projectType !== 'github' || !project.githubOwner || !project.githubRepo) {
    throw new Error('Project is not GitHub-linked')
  }

  const token = await resolveGitHubToken(project.githubOwner, project.githubRepo, userId, teamId ?? null)
  if (!token) throw new Error(`No GitHub token available for ${project.githubOwner}/${project.githubRepo}`)

  const [issues, rawPrs] = await Promise.all([
    fetchIssues(token.token, project.githubOwner, project.githubRepo),
    fetchPullRequests(token.token, project.githubOwner, project.githubRepo),
  ])
  const prs = await enrichPullRequests(token.token, project.githubOwner, project.githubRepo, rawPrs)

  await upsertIssueCacheEntries(project.id, issues)
  await upsertPrCacheEntries(project.id, prs.map((pr) => ({ ...pr, projectId: project.id })))

  return {
    issueCount: issues.length,
    prCount: prs.length,
    syncedAt: new Date().toISOString(),
  }
}

export async function syncGitHubRepoCacheByProjectId(projectId: string): Promise<{ issueCount: number; prCount: number; syncedAt: string } | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return null
  return syncGitHubRepoCache(project, project.ownerId, project.teamId)
}

function toCachedIssue(row: typeof githubIssueCache.$inferSelect): GitHubCachedIssue {
  return {
    id: row.id,
    projectId: row.projectId,
    issueNumber: row.issueNumber,
    title: row.title,
    body: row.body,
    state: row.state as GitHubCachedIssue['state'],
    url: row.url,
    authorLogin: row.authorLogin,
    labels: (row.labels ?? []) as GitHubCachedIssue['labels'],
    assignees: (row.assignees ?? []) as GitHubCachedIssue['assignees'],
    commentsCount: row.commentsCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    cachedAt: row.cachedAt,
  }
}

function toCachedPr(row: typeof githubPrCache.$inferSelect): GitHubCachedPr {
  return {
    id: row.id,
    projectId: row.projectId,
    prNumber: row.prNumber,
    title: row.title,
    body: row.body,
    state: row.state as GitHubCachedPr['state'],
    url: row.url,
    authorLogin: row.authorLogin,
    headBranch: row.headBranch,
    baseBranch: row.baseBranch,
    labels: (row.labels ?? []) as GitHubCachedPr['labels'],
    ciStatus: (row.ciStatus as GitHubCachedPr['ciStatus']) ?? null,
    reviewDecision: normalizeReviewDecision(row.reviewDecision),
    mergeableState: (row.mergeableState as GitHubCachedPr['mergeableState']) ?? null,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changedFiles,
    commentsCount: row.commentsCount,
    draft: row.draft,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mergedAt: row.mergedAt,
    closedAt: row.closedAt,
    cachedAt: row.cachedAt,
  }
}

export async function getRepoCacheSnapshot(projectId: string): Promise<GitHubRepoCacheSnapshot> {
  const [issueRows, prRows] = await Promise.all([
    db.select().from(githubIssueCache).where(eq(githubIssueCache.projectId, projectId)).orderBy(desc(githubIssueCache.updatedAt), desc(githubIssueCache.issueNumber)),
    db.select().from(githubPrCache).where(eq(githubPrCache.projectId, projectId)).orderBy(desc(githubPrCache.updatedAt), desc(githubPrCache.prNumber)),
  ])

  const lastSyncedAt = [...issueRows.map((row) => row.cachedAt), ...prRows.map((row) => row.cachedAt)]
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return {
    projectId,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    issues: issueRows.map(toCachedIssue),
    pullRequests: prRows.map(toCachedPr),
  }
}

export async function getWorkspaceGitHubSummary(projectIds: string[]): Promise<GitHubWorkspaceSummary> {
  if (projectIds.length === 0) {
    return { projects: [], attention: [] }
  }

  const projectRows = await db.select().from(projects)
    .where(and(inArray(projects.id, projectIds), eq(projects.projectType, 'github')))

  const [issueRows, prRows] = await Promise.all([
    db.select().from(githubIssueCache).where(inArray(githubIssueCache.projectId, projectIds)),
    db.select().from(githubPrCache).where(inArray(githubPrCache.projectId, projectIds)),
  ])

  const issues = issueRows.map(toCachedIssue)
  const prs = prRows.map(toCachedPr)

  const summaries: GitHubWorkspaceProjectSummary[] = projectRows.map((project) => {
    const projectIssues = issues.filter((issue) => issue.projectId === project.id)
    const projectPrs = prs.filter((pr) => pr.projectId === project.id)
    const lastSyncedAt = [...projectIssues.map((issue) => issue.cachedAt), ...projectPrs.map((pr) => pr.cachedAt)]
      .sort((a, b) => b.getTime() - a.getTime())[0]

    return {
      projectId: project.id,
      projectName: project.name,
      repo: `${project.githubOwner}/${project.githubRepo}`,
      openIssues: projectIssues.filter((issue) => issue.state === 'open').length,
      openPullRequests: projectPrs.filter((pr) => pr.state === 'open').length,
      failingPrs: projectPrs.filter((pr) => pr.state === 'open' && pr.ciStatus === 'failure').length,
      changesRequestedPrs: projectPrs.filter((pr) => pr.state === 'open' && pr.reviewDecision === 'changes_requested').length,
      readyToMergePrs: projectPrs.filter((pr) => pr.state === 'open' && pr.ciStatus === 'success' && pr.reviewDecision === 'approved' && pr.mergeableState === 'mergeable').length,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  })

  return {
    projects: summaries,
    attention: deriveAttentionItems(summaries, prs)
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .slice(0, 12),
  }
}

export async function getLinkedNodeIdsForProject(projectId: string): Promise<{
  issueNodeIds: Record<number, string>
  prNodeIds: Record<number, string>
}> {
  const rows = await db.select({
    clientId: planNodes.clientId,
    githubIssueNumber: planNodes.githubIssueNumber,
    prNumber: planNodes.prNumber,
  }).from(planNodes).where(eq(planNodes.projectId, projectId))

  const issueNodeIds: Record<number, string> = {}
  const prNodeIds: Record<number, string> = {}

  for (const row of rows) {
    if (row.githubIssueNumber != null) issueNodeIds[row.githubIssueNumber] = row.clientId
    if (row.prNumber != null) prNodeIds[row.prNumber] = row.clientId
  }

  return { issueNodeIds, prNodeIds }
}

export async function syncAllGitHubRepoCaches(): Promise<void> {
  const githubProjects = await db.select().from(projects).where(eq(projects.projectType, 'github'))
  for (const project of githubProjects) {
    try {
      await syncGitHubRepoCache(project, project.ownerId, project.teamId)
    } catch (error) {
      console.error(`[github-cache] Failed syncing ${project.githubOwner}/${project.githubRepo}:`, error)
    }
  }
}

export async function backfillGitHubRepoCacheForProject(project: Project): Promise<void> {
  const fullProject = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
  if (!fullProject[0]) return
  await syncGitHubRepoCache(fullProject[0], fullProject[0].ownerId, fullProject[0].teamId)
}
