import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router"
import { Loader2, Users, CheckCircle2, AlertTriangle, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuthStore } from "@/stores/auth-store"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"

interface InviteDetails {
  email: string
  role: string
  teamName: string
  expiresAt: string
  userExists: boolean
}

export function TeamInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)
  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Fetch invite details
  useEffect(() => {
    const fetchInvite = async () => {
      if (!token) {
        setError('Invalid invitation link')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/teams/invite/${token}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch invitation')
        }

        const data = await response.json()
        setInvite(data.invite)
        setLoading(false)
      } catch (err) {
        console.error('[team-invite] Failed to fetch invite:', err)
        setError(err instanceof Error ? err.message : 'Failed to load invitation')
        setLoading(false)
      }
    }

    fetchInvite()
  }, [token])

  const handleAccept = async () => {
    if (!token || !session) {
      // User needs to login first
      navigate(`/login?redirect=/invite/${token}`)
      return
    }

    setAccepting(true)
    try {
      const response = await fetch(`/api/teams/accept/${token}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to accept invitation')
      }

      setSuccess(true)
      // Redirect to settings/teams after 2 seconds
      setTimeout(() => {
        navigate('/settings?tab=teams')
      }, 2000)
    } catch (err) {
      console.error('[team-invite] Failed to accept invite:', err)
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      setAccepting(false)
    }
  }

  if (!isServerMode()) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-2xl font-semibold">Teams Not Available</h1>
              <p className="text-sm text-muted-foreground">
                Team invitations are only available in server mode
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    )
  }

  if (error || !invite) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-2xl font-semibold">Invalid Invitation</h1>
              <p className="text-sm text-muted-foreground">
                {error || 'This invitation link is invalid or has expired'}
              </p>
            </div>
            <Button onClick={() => navigate('/')}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-2xl font-semibold">Welcome to {invite.teamName}!</h1>
              <p className="text-sm text-muted-foreground">
                You've successfully joined the team. Redirecting...
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const expiryDate = new Date(invite.expiresAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-lg">
        {/* Header */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <div className="flex flex-col gap-2 text-center">
            <h1 className="text-2xl font-semibold">You're invited!</h1>
            <p className="text-sm text-muted-foreground">
              Join <span className="font-medium text-foreground">{invite.teamName}</span> on Astro
            </p>
          </div>
        </div>

        {/* Invitation Details */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{invite.email}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Role</span>
            <Badge variant="secondary" className="capitalize">
              {invite.role}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Expires</span>
            <span className="text-sm">{expiryDate}</span>
          </div>
        </div>

        {/* Action */}
        {!session ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              {invite.userExists
                ? 'Sign in to accept this invitation'
                : 'Create an account to join the team'}
            </p>
            <Button onClick={handleAccept} size="lg" className="w-full">
              {invite.userExists ? 'Sign In & Accept' : 'Create Account & Accept'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <Button
              onClick={handleAccept}
              disabled={accepting}
              size="lg"
              className="w-full"
            >
              {accepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                'Accept Invitation'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/')}
              disabled={accepting}
              className="w-full"
            >
              Decline
            </Button>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          This invitation is only valid for{' '}
          <span className="font-medium text-foreground">{invite.email}</span>
        </p>
      </div>
    </div>
  )
}
