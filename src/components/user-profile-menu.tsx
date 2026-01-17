'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ChevronUp, Crown, LogIn, Sparkles, Zap } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import supabaseClient from '@/lib/supabase/browser-client'
import { useUserIdentity } from '@/components/user-identity-provider'
import { useUserPlan } from '@/lib/hooks/use-user-plan'

interface UserProfileMenuProps {
  isCompressed?: boolean
  onSettingsOpen?: () => void
  onGeneralSettingsOpen?: () => void
}

function initialsFromName(name?: string | null, fallback?: string | null) {
  const source = name || fallback || '';
  const parts = source.trim().split(/\s+/);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserProfileMenu({ isCompressed, onSettingsOpen, onGeneralSettingsOpen }: UserProfileMenuProps) {
  const router = useRouter()
  const { fullName, email, isGuest, avatarUrl } = useUserIdentity()
  const { plan } = useUserPlan()
  const displayName = isGuest ? 'Guest' : fullName || email || 'User'
  const initials = initialsFromName(fullName, email)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const showAvatar = Boolean(avatarUrl) && !avatarFailed && !isGuest

  const normalizedPlan = (typeof plan === 'string' ? plan : 'free').toLowerCase()

  const getPlanIcon = () => {
    switch (normalizedPlan) {
      case 'max':
        return <Crown className="h-2.5 w-2.5" suppressHydrationWarning />
      case 'plus':
        return <Zap className="h-2.5 w-2.5" suppressHydrationWarning />
      default:
        return <Sparkles className="h-2.5 w-2.5" suppressHydrationWarning />
    }
  }

  const getPlanLabel = () => {
    if (isGuest) return 'Guest'
    if (normalizedPlan === 'max') return 'Max'
    if (normalizedPlan === 'plus') return 'Plus'
    return 'Free'
  }

  const handleUpgradePlan = () => {
    router.push('/upgrade')
  }

  const handleSignOut = async () => {
    if (isGuest) {
      window.location.href = '/login'
      return
    }
    await supabaseClient.auth.signOut()
    // Hard reload to flush any cached client state and render guest mode cleanly.
    window.location.href = '/'
  }

  return (
    <>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isCompressed ? (
              <Button
                variant="ghost"
                className="w-12 h-10 p-0 justify-center gap-2 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg sidebar-entry sidebar-entry-static overflow-hidden transition-all duration-200"
              >
                {showAvatar ? (
                  <img
                    src={avatarUrl as string}
                    alt={displayName}
                    className="h-9 w-9 rounded-full object-cover border border-white/10"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500/70 via-slate-700 to-[#0b0b14] flex items-center justify-center text-xs font-semibold text-white border border-white/10">
                    {initials}
                  </div>
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="w-full max-w-[240px] justify-start px-2.5 h-10 gap-2 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg sidebar-entry sidebar-entry-static overflow-hidden transition-all duration-200"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {showAvatar ? (
                    <img
                      src={avatarUrl as string}
                      alt={displayName}
                      className="h-9 w-9 rounded-full object-cover border border-white/10 flex-shrink-0"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500/70 via-slate-700 to-[#0b0b14] flex items-center justify-center text-xs font-semibold text-white border border-white/10 flex-shrink-0">
                      {initials}
                    </div>
                  )}
                <div className="flex flex-col items-start min-w-0">
                    <span
                      className="text-xs font-medium text-sidebar-foreground truncate"
                      title={displayName}
                    >
                      {displayName}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                      {getPlanIcon()}
                      {getPlanLabel()}
                    </span>
                  </div>
                </div>
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align={isCompressed ? "center" : "end"} sideOffset={10} collisionPadding={12} className="w-56">
            {!isGuest && (
              <>
                <DropdownMenuItem onClick={() => onSettingsOpen?.()}>
                  Personalization
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onGeneralSettingsOpen?.()}>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={handleUpgradePlan}>Upgrade Plan</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut}>
              {isGuest ? (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              ) : (
                'Sign Out'
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
