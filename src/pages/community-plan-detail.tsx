import { useEffect, useState } from "react"
import { useParams, useNavigate, Link } from "react-router"
import { ArrowLeft, Star, GitFork, Download, Calendar, User, Tag, Layers, FileText, MessageSquare } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { formatDistanceToNow } from "date-fns"
import { useCommunityStore } from "@/stores/community-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface CommentItemProps {
  id: string
  authorName: string
  content: string
  createdAt: Date
  parentCommentId: string | null
  onReply: (commentId: string) => void
}

function CommentItem({ authorName, content, createdAt, onReply, id }: CommentItemProps) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{authorName}</span>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(createdAt, { addSuffix: true })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{content}</p>
      <button
        type="button"
        onClick={() => onReply(id)}
        className="text-xs font-medium text-primary hover:underline self-start"
      >
        Reply
      </button>
    </div>
  )
}

export function CommunityPlanDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const plan = useCommunityStore((s) => s.selectedPlan)
  const comments = useCommunityStore((s) => s.comments)
  const isLoading = useCommunityStore((s) => s.isLoading)
  const fetchPlan = useCommunityStore((s) => s.fetchPlan)
  const fetchComments = useCommunityStore((s) => s.fetchComments)
  const toggleStar = useCommunityStore((s) => s.toggleStar)
  const forkPlan = useCommunityStore((s) => s.forkPlan)
  const addComment = useCommunityStore((s) => s.addComment)
  const clearSelectedPlan = useCommunityStore((s) => s.clearSelectedPlan)

  const [commentContent, setCommentContent] = useState("")
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [isStarring, setIsStarring] = useState(false)
  const [isForking, setIsForking] = useState(false)
  const [forkDialogOpen, setForkDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState("")

  // Load plan and comments on mount
  useEffect(() => {
    if (id) {
      fetchPlan(id)
      fetchComments(id)
    }
    return () => clearSelectedPlan()
  }, [id, fetchPlan, fetchComments, clearSelectedPlan])

  const handleStar = async () => {
    if (!id || isStarring) return
    setIsStarring(true)
    try {
      await toggleStar(id)
    } finally {
      setIsStarring(false)
    }
  }

  const handleFork = async () => {
    if (!id || !projectName.trim() || isForking) return
    setIsForking(true)
    try {
      const projectId = await forkPlan(id, projectName.trim())
      setForkDialogOpen(false)
      navigate(`/project/${projectId}`)
    } catch (err) {
      console.error("Failed to fork plan:", err)
    } finally {
      setIsForking(false)
    }
  }

  const handleAddComment = async () => {
    if (!id || !commentContent.trim()) return
    try {
      await addComment(id, commentContent.trim(), replyingTo || undefined)
      setCommentContent("")
      setReplyingTo(null)
    } catch (err) {
      console.error("Failed to add comment:", err)
    }
  }

  const handleDownloadJSON = () => {
    if (!plan) return
    const data = {
      title: plan.title,
      description: plan.description,
      visionDoc: plan.visionDoc,
      planData: plan.planData,
      category: plan.category,
      tags: plan.tags,
      customizationNotes: plan.customizationNotes,
      customizableFields: plan.customizableFields,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${plan.title.toLowerCase().replace(/\s+/g, "-")}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Thread comments by parent
  const threadedComments = comments.filter((c) => !c.parentCommentId)
  const repliesByParent = comments.reduce((acc, comment) => {
    if (comment.parentCommentId) {
      if (!acc[comment.parentCommentId]) acc[comment.parentCommentId] = []
      acc[comment.parentCommentId].push(comment)
    }
    return acc
  }, {} as Record<string, typeof comments>)

  if (isLoading && !plan) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading plan...</div>
      </div>
    )
  }

  if (!plan && !isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Plan not found</p>
        <Button variant="outline" asChild>
          <Link to="/community">Back to Community</Link>
        </Button>
      </div>
    )
  }

  if (!plan) return null

  const authorDisplayName = plan.isAnonymous ? "Anonymous" : (plan.authorName || "Unknown")

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex-none border-b bg-card px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/community")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">{plan.title}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>{authorDisplayName}</span>
              {plan.category && (
                <>
                  <span>•</span>
                  <Badge variant="secondary" className="text-xs">
                    {plan.category}
                  </Badge>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStar}
              disabled={isStarring}
              className={cn(
                "gap-2",
                isStarring && "opacity-50"
              )}
            >
              <Star className={cn("h-4 w-4", isStarring && "fill-primary")} />
              Star ({plan.starsCount})
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setForkDialogOpen(true)}
              disabled={isForking}
              className="gap-2"
            >
              <GitFork className="h-4 w-4" />
              Use This Plan
            </Button>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content - tabs */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-5xl">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="overview" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Plan Preview
                </TabsTrigger>
                <TabsTrigger value="comments" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({comments.length})
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6 mt-6">
                {/* Description */}
                {plan.description && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Description</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {plan.description}
                        </ReactMarkdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Customization Notes */}
                {plan.customizationNotes && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Customization Guide</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {plan.customizationNotes}
                        </ReactMarkdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Execution Summary */}
                {plan.executionSummary && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Execution Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        {plan.executionSummary.totalTasks !== undefined && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Total Tasks</span>
                            <span className="text-2xl font-semibold">{plan.executionSummary.totalTasks}</span>
                          </div>
                        )}
                        {plan.executionSummary.completed !== undefined && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Completed</span>
                            <span className="text-2xl font-semibold text-success">{plan.executionSummary.completed}</span>
                          </div>
                        )}
                        {plan.executionSummary.failed !== undefined && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Failed</span>
                            <span className="text-2xl font-semibold text-destructive">{plan.executionSummary.failed}</span>
                          </div>
                        )}
                        {plan.executionSummary.totalCost !== undefined && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Total Cost</span>
                            <span className="text-2xl font-semibold">${plan.executionSummary.totalCost.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Tags */}
                {plan.tags.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Tags</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {plan.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            <Tag className="mr-1 h-3 w-3" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Plan Preview Tab */}
              <TabsContent value="preview" className="mt-6">
                <div className="space-y-6">
                  {/* Vision Doc Preview */}
                  {plan.visionDoc && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Vision Document</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {plan.visionDoc}
                          </ReactMarkdown>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Read-only Plan Canvas */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Plan Graph</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="h-[600px] w-full border-t">
                        {/* TODO: Render read-only plan canvas. This requires creating a temporary project
                            context with the plan data (nodes/edges). For now, showing node/edge counts. */}
                        <div className="flex h-full items-center justify-center">
                          <div className="text-center space-y-3">
                            <Layers className="h-12 w-12 mx-auto text-muted-foreground" />
                            <p className="text-sm font-medium text-foreground">
                              Plan with {plan.planData.nodes.length} nodes and {plan.planData.edges.length} edges
                            </p>
                            <p className="text-xs text-muted-foreground max-w-sm">
                              Interactive graph preview coming soon
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Comments Tab */}
              <TabsContent value="comments" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Discussion</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Add comment form */}
                    <div className="space-y-3">
                      <textarea
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                        placeholder={replyingTo ? "Write a reply..." : "Add a comment..."}
                        className="min-h-[100px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleAddComment}
                          disabled={!commentContent.trim()}
                        >
                          {replyingTo ? "Reply" : "Comment"}
                        </Button>
                        {replyingTo && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplyingTo(null)
                              setCommentContent("")
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Comments list */}
                    {threadedComments.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-8">
                        No comments yet. Be the first to comment!
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {threadedComments.map((comment) => (
                          <div key={comment.id} className="space-y-2">
                            <CommentItem
                              {...comment}
                              onReply={(id) => {
                                setReplyingTo(id)
                                setCommentContent("")
                              }}
                            />
                            {/* Replies */}
                            {repliesByParent[comment.id] && (
                              <div className="ml-8 space-y-2 border-l-2 border-border pl-4">
                                {repliesByParent[comment.id].map((reply) => (
                                  <CommentItem
                                    key={reply.id}
                                    {...reply}
                                    onReply={(id) => {
                                      setReplyingTo(id)
                                      setCommentContent("")
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden lg:block w-80 border-l bg-muted/30 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Author Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Author</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{authorDisplayName}</span>
                </div>
                {plan.authorBio && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {plan.authorBio}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Metadata */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {plan.category && (
                  <div className="flex items-start gap-2">
                    <Tag className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <div className="text-muted-foreground">Category</div>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {plan.category}
                      </Badge>
                    </div>
                  </div>
                )}
                {plan.templateId && (
                  <div className="flex items-start gap-2">
                    <Layers className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <div className="text-muted-foreground">Template</div>
                      <div className="mt-1 text-sm font-medium">{plan.templateId}</div>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <div className="text-muted-foreground">Created</div>
                    <div className="mt-1 text-sm">
                      {formatDistanceToNow(plan.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <div className="text-muted-foreground">Updated</div>
                    <div className="mt-1 text-sm">
                      {formatDistanceToNow(plan.updatedAt, { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Stars</span>
                  <span className="font-medium">{plan.starsCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Forks</span>
                  <span className="font-medium">{plan.forksCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nodes</span>
                  <span className="font-medium">{plan.planData.nodes.length}</span>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleDownloadJSON}
                >
                  <Download className="h-4 w-4" />
                  Download JSON
                </Button>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      {/* Fork Dialog (Simple inline modal) */}
      {forkDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Fork Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="project-name" className="text-sm font-medium">
                  Project Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleFork}
                  disabled={!projectName.trim() || isForking}
                  className="flex-1"
                >
                  {isForking ? "Forking..." : "Fork Plan"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setForkDialogOpen(false)}
                  disabled={isForking}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
