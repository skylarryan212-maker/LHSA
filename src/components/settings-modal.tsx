'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Palette, Database, UserCircle, ChevronDown, Info, Copy, Eye, EyeOff, Sparkles, Download, Check, Archive, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { ImportModal } from '@/components/import-modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { applyAccentColor } from '@/components/accent-color-provider'
import { updateAccentColorAction } from '@/app/actions/preferences-actions'
import { getContextModeGlobalPreference, saveContextModeGlobalPreference } from '@/app/actions/user-preferences-actions'
import { useUserPlan } from '@/lib/hooks/use-user-plan'
import { useUserIdentity } from '@/components/user-identity-provider'
import supabaseClient from '@/lib/supabase/browser-client'
import { getUserPlanDetails, cancelSubscription } from '@/app/actions/plan-actions'
import { getUserTotalSpending, getMonthlySpending } from '@/app/actions/usage-actions'
import { getUsageStatus } from '@/lib/usage-limits'
import { PersonalizationPanel } from '@/components/personalization-panel'
import { useChatStore } from '@/components/chat/chat-provider'
import { getAllowDataForImprovement, saveAllowDataForImprovement } from '@/app/actions/user-preferences-actions'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: TabType
}

type TabType = 'preferences' | 'personalization' | 'data' | 'account'
const SPEED_MODE_STORAGE_KEY = "llm-client-speed-mode"

function ThemedCheckbox(props: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onCheckedChange(e.target.checked)}
        className="peer h-5 w-5 shrink-0 appearance-none rounded-md border border-border bg-background shadow-sm transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Check className="pointer-events-none absolute left-0 top-0 h-5 w-5 p-[3px] text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
    </div>
  );
}

export function SettingsModal({ isOpen, onClose, initialTab = 'preferences' }: SettingsModalProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [accentColor, setAccentColor] = useState('white')
  const { plan, refreshPlan } = useUserPlan()
  const [contextModeGlobal, setContextModeGlobal] = useState<"advanced" | "simple">("simple")
  const [speedModeEnabled, setSpeedModeEnabled] = useState(false)
  const { fullName, email, isGuest, tokenAuth } = useUserIdentity()
  const { refreshChats } = useChatStore()

  const [planDetails, setPlanDetails] = useState<{
    planType: string
    renewalDate: string | null
    cancelAt: string | null
    cancelAtPeriodEnd: boolean
    isActive: boolean
    pendingPlanType: string | null
    pendingSwitchAt: string | null
  } | null>(null)
  const [totalSpending, setTotalSpending] = useState<number | null>(null)
  const [monthlySpending, setMonthlySpending] = useState<number | null>(null)
  const [usageStatus, setUsageStatus] = useState<{
    exceeded: boolean
    warning: boolean
    percentage: number
    remaining: number
    limit: number
  } | null>(null)
  const [tokenKey, setTokenKey] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle")
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelProcessing, setCancelProcessing] = useState(false)
  const [cancelResultDialog, setCancelResultDialog] = useState<{ open: boolean; message: string; success: boolean }>({ open: false, message: "", success: false })
  const [deleteAllChatsConfirmOpen, setDeleteAllChatsConfirmOpen] = useState(false)
  const [deleteAllChatsProcessing, setDeleteAllChatsProcessing] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [allowDataForImprovement, setAllowDataForImprovement] = useState(false)

  const fetchAccountData = useCallback(async () => {
    try {
      const [details, total, monthly] = await Promise.all([
        getUserPlanDetails(),
        getUserTotalSpending(),
        getMonthlySpending()
      ])

      setPlanDetails(details)
      setTotalSpending(total)
      setMonthlySpending(monthly)

      const status = details ? getUsageStatus(monthly, details.planType) : null
      setUsageStatus(status)

    } catch (error) {
      console.error('Failed to load account data', error)
    }
  }, [])

  useEffect(() => {
    // Refresh account data in the background regardless of modal state
    fetchAccountData()
    const interval = setInterval(fetchAccountData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchAccountData])

  useEffect(() => {
    if (isOpen && activeTab === 'account') {
      fetchAccountData()
    }
  }, [isOpen, activeTab, fetchAccountData])

  useEffect(() => {
    // Accent color is now loaded from server via AccentColorProvider
    // We just need to sync the local state when modal opens
    if (isOpen) {
      let alive = true
      setActiveTab(initialTab)
      try {
        const storedSpeedMode = window.localStorage.getItem(SPEED_MODE_STORAGE_KEY)
        setSpeedModeEnabled(storedSpeedMode === "1")
      } catch {}
      const styleEl = document.getElementById('accent-color-override')
      if (styleEl) {
        const content = styleEl.textContent || ''
        if (content.includes('oklch(0.985 0 0)')) setAccentColor('white')
        else if (content.includes('oklch(0.65 0.18 145)')) setAccentColor('green')
        else if (content.includes('oklch(0.70 0.22 240)')) setAccentColor('blue')
        else if (content.includes('oklch(0.70 0.24 290)')) setAccentColor('purple')
        else if (content.includes('oklch(0.75 0.26 330)')) setAccentColor('pink')
        else if (content.includes('oklch(0.75 0.22 50)')) setAccentColor('orange')
        else if (content.includes('oklch(0.70 0.26 25)')) setAccentColor('red')
      }
      // Always refresh plan and usage when opening to avoid stale cache
      refreshPlan().catch(() => {})
      fetchAccountData().catch(() => {})
      try {
        const storedMode = window.localStorage.getItem("context-mode-global")
        if (storedMode === "simple" || storedMode === "advanced") {
          setContextModeGlobal(storedMode)
        }
      } catch {}

      if (!isGuest) {
        getContextModeGlobalPreference()
          .then((mode) => {
            if (!alive) return
            setContextModeGlobal(mode)
            try {
              window.localStorage.setItem("context-mode-global", mode)
              window.dispatchEvent(
                new CustomEvent("contextModeGlobalChange", { detail: mode })
              )
            } catch {}
          })
          .catch(() => {})

        getAllowDataForImprovement()
          .then((allowed) => {
            if (!alive) return
            setAllowDataForImprovement(allowed)
          })
          .catch(() => {})
      }

      return () => {
        alive = false
      }
    }
  }, [isOpen, initialTab, isGuest, refreshPlan, fetchAccountData])

  useEffect(() => {
    if (!isOpen) return

    const el = contentScrollRef.current
    if (!el) return

    const update = () => {
      const maxScrollTop = el.scrollHeight - el.clientHeight
      const scrollTop = el.scrollTop
      setCanScrollUp(scrollTop > 2)
      setCanScrollDown(scrollTop < maxScrollTop - 2)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isOpen, activeTab])

  useEffect(() => {
    if (!isOpen || activeTab !== 'account' || !tokenAuth) {
      setTokenKey(null)
      setTokenLoading(false)
      setTokenVisible(false)
      return
    }

    let alive = true
    setTokenLoading(true)
    const loadTokenKey = async () => {
      try {
        const result = await supabaseClient
          .from("token_auth_keys")
          .select("token")
          .maybeSingle()
        if (!alive) return
        setTokenKey(result.data?.token ?? null)
        setTokenVisible(false)
        setCopyStatus("idle")
      } catch (error) {
        console.error("[settings][token] failed to load token", error)
        if (!alive) return
        setTokenKey(null)
      } finally {
        if (!alive) return
        setTokenLoading(false)
      }
    }

    loadTokenKey()
    return () => {
      alive = false
    }
  }, [isOpen, activeTab, tokenAuth])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleAccentColorChange = (newColor: string) => {
    // Only save when user explicitly changes the color
    setAccentColor(newColor)
    
    // Apply the accent color immediately
    applyAccentColor(newColor)
    
    // Dispatch custom event so AccentColorProvider can react
    window.dispatchEvent(new CustomEvent('accentColorChange', { detail: newColor }))
    
    // Save to Supabase (async, non-blocking)
    updateAccentColorAction(newColor)
      .then((result) => {
        if (!result.success) {
          console.error('Failed to save accent color:', result.error)
        }
      })
  }

  const handleSpeedModeToggle = (nextEnabled: boolean) => {
    setSpeedModeEnabled(nextEnabled)
    try {
      if (nextEnabled) {
        window.localStorage.setItem(SPEED_MODE_STORAGE_KEY, "1")
      } else {
        window.localStorage.removeItem(SPEED_MODE_STORAGE_KEY)
      }
      window.dispatchEvent(new CustomEvent("speedModeChange", { detail: nextEnabled }))
    } catch {}

    if (nextEnabled) {
      setContextModeGlobal("simple")
      try {
        window.localStorage.setItem("context-mode-global", "simple")
        window.dispatchEvent(
          new CustomEvent("contextModeGlobalChange", { detail: "simple" })
        )
      } catch {}
      if (!isGuest) {
        saveContextModeGlobalPreference("simple").catch(() => {})
      }
    }
  }

  const handleChangePlan = () => {
    onClose()
    router.push('/upgrade?showAll=true')
  }

  const handleCancelSubscription = async () => {
    setCancelConfirmOpen(false)
    setCancelProcessing(true)
    
    const result = await cancelSubscription()
    if (result.success) {
      // Clear plan cache to force immediate update everywhere
      try {
        window.localStorage.removeItem('user_plan_cache')
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('api-usage-updated'))
      } catch {}
      
      // Refresh plan status everywhere
      await refreshPlan()
      
      // Refresh all plan-related data in the settings modal
      const [details, total, monthly] = await Promise.all([
        getUserPlanDetails(),
        getUserTotalSpending(),
        getMonthlySpending()
      ])
      setPlanDetails(details)
      setTotalSpending(total)
      setMonthlySpending(monthly)
      
      if (details) {
        const status = getUsageStatus(monthly, details.planType)
        setUsageStatus(status)
      }
    }
    
    setCancelResultDialog({ 
      open: true, 
      message: result.message,
      success: result.success
    })
    setCancelProcessing(false)
  }

  const handleDeleteAllChats = async () => {
    setDeleteAllChatsConfirmOpen(false)
    setDeleteAllChatsProcessing(true)
    
    try {
      const { deleteAllConversationsAction } = await import('@/app/actions/chat-actions')
      await deleteAllConversationsAction()
      try {
        await refreshChats()
      } catch (refreshErr) {
        console.error('Failed to refresh chats after deletion:', refreshErr)
      }
      
      // Close modal and redirect to home
      onClose()
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Failed to delete all chats:', error)
      alert('Failed to delete all chats. Please try again.')
    } finally {
      setDeleteAllChatsProcessing(false)
    }
  }

  const handleCopyToken = async () => {
    if (!tokenKey || typeof navigator === "undefined" || !navigator.clipboard) {
      return
    }
    try {
      await navigator.clipboard.writeText(tokenKey)
      setCopyStatus("copied")
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopyStatus("idle")
      }, 1500)
    } catch (error) {
      console.error("[settings][token] failed to copy token", error)
    }
  }

  const handleAllowDataForImprovementToggle = async (nextValue: boolean) => {
    setAllowDataForImprovement(nextValue)
    try {
      const result = await saveAllowDataForImprovement(nextValue)
      if (!result.success) {
        console.error('Failed to save data improvement preference:', result.message)
        // Revert on error
        setAllowDataForImprovement(!nextValue)
      }
    } catch (error) {
      console.error('Failed to save data improvement preference:', error)
      // Revert on error
      setAllowDataForImprovement(!nextValue)
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'preferences' as TabType, label: 'Preferences', icon: Palette },
    { id: 'personalization' as TabType, label: 'Personalization', icon: Sparkles },
    { id: 'data' as TabType, label: 'Data', icon: Database },
    { id: 'account' as TabType, label: 'Account & Plan', icon: UserCircle },
  ]

  const accentColors = [
    { value: 'white', label: 'White', class: 'bg-white border border-border' },
    { value: 'green', label: 'Green', class: 'bg-green-500' },
    { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
    { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
    { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
    { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
    { value: 'red', label: 'Red', class: 'bg-red-500' },
  ]

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div
        className="modal-panel relative flex flex-col sm:flex-row h-[58vh] max-h-[58vh] w-full max-w-[min(520px,95vw)] sm:max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl pointer-events-auto"
      >
        {/* Sidebar */}
        <div className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-border bg-muted/30 px-3 pt-3 pb-3">
          <div className="mb-3 flex h-8 items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                  className="w-full justify-start gap-3 text-sm"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              )
            })}
          </div>

          <div aria-hidden="true" className="mt-3 h-8" />
        </div>

        {/* Content */}
        <div className="relative flex-1 min-h-0">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 top-0 z-10 h-10 bg-gradient-to-b from-black/35 to-transparent transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-12 bg-gradient-to-t from-black/35 to-transparent transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
          />
          <div ref={contentScrollRef} className="h-full overflow-y-auto p-6 sm:p-8">
          {activeTab === 'preferences' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Preferences</h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <Label className="text-sm font-normal">Theme</Label>
                  <Select defaultValue="system">
                    <SelectTrigger className="w-36 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <Label className="text-sm font-normal">Accent color</Label>
                  <div className="flex items-center gap-2">
                    {accentColors.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => handleAccentColorChange(color.value)}
                        className={`h-5 w-5 rounded-full ${color.class} transition-all ${
                          accentColor === color.value
                            ? 'ring-2 ring-offset-1 ring-offset-background ring-primary'
                            : 'hover:scale-105'
                        }`}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <Label className="text-sm font-normal">Context mode (default)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-sm"
                    disabled={speedModeEnabled}
                    title={speedModeEnabled ? "Speed Mode forces simple context." : undefined}
                    onClick={() => {
                      const next = contextModeGlobal === "simple" ? "advanced" : "simple"
                      setContextModeGlobal(next)
                      try {
                        window.localStorage.setItem("context-mode-global", next)
                        window.dispatchEvent(
                          new CustomEvent("contextModeGlobalChange", { detail: next })
                        )
                      } catch {}
                      if (!isGuest) {
                        saveContextModeGlobalPreference(next)
                          .then((result) => {
                            if (!result.success) {
                              console.error('Failed to save context mode:', result.message)
                            }
                          })
                          .catch(() => {})
                      }
                    }}
                  >
                    {contextModeGlobal === "simple" ? "Simple" : "Advanced"}
                  </Button>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-normal">Speed Mode</Label>
                    <span title="Disables auto model selection and advanced context to keep responses fast.">
                      <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  </div>
                  <Button
                    variant={speedModeEnabled ? "secondary" : "outline"}
                    size="sm"
                    className="h-8 px-3 text-sm"
                    onClick={() => handleSpeedModeToggle(!speedModeEnabled)}
                  >
                    {speedModeEnabled ? "On" : "Off"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personalization' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Personalization</h2>
              </div>
              <PersonalizationPanel />
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Data</h2>
              </div>

              <div className="space-y-4">
                <div className="py-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <label htmlFor="allowDataForImprovement" className="text-sm font-medium text-foreground cursor-pointer">
                        Help improve Quarry
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Allow the use of your chats to help train and improve Quarry.
                      </p>
                    </div>
                    <ThemedCheckbox
                      id="allowDataForImprovement"
                      checked={allowDataForImprovement}
                      onCheckedChange={handleAllowDataForImprovementToggle}
                    />
                  </div>
                </div>

                <div className="py-2 border-t border-border/50">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium text-foreground">Import chats</h3>
                      <p className="text-xs text-muted-foreground">
                        Import your chat history from ChatGPT or Claude.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsImportOpen(true)}
                      className="h-8 ml-4 gap-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Import
                    </Button>
                  </div>
                </div>

                <div className="py-2 border-t border-border/50">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium text-foreground">Delete all chats</h3>
                      <p className="text-xs text-muted-foreground">
                        Permanently delete all your chat conversations. This action cannot be undone.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteAllChatsConfirmOpen(true)}
                      disabled={deleteAllChatsProcessing}
                      className="h-8 ml-4"
                    >
                      {deleteAllChatsProcessing ? 'Deleting...' : 'Delete all'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Account & Plan</h2>
              </div>

              {/* Plan Information */}
              <div className="py-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-medium text-foreground capitalize">
                        {plan} Plan
                      </h3>
                    </div>
                    {planDetails?.renewalDate && plan !== 'free' && (
                      <p className="text-xs text-muted-foreground">
                        {planDetails.cancelAtPeriodEnd && planDetails.cancelAt ? (
                          <>Your plan will be canceled on {new Date(planDetails.cancelAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
                        ) : (
                          <>Your plan auto-renews on {new Date(planDetails.renewalDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
                        )}
                      </p>
                    )}
                    {planDetails?.pendingPlanType && planDetails?.pendingSwitchAt && (
                      <p className="text-xs text-amber-200">
                        Switch to {planDetails.pendingPlanType} scheduled for{" "}
                        {new Date(planDetails.pendingSwitchAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  {plan === 'free' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8"
                      onClick={handleChangePlan}
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      Upgrade
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1 h-8">
                          Manage
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={handleChangePlan}>
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Change plan
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setCancelConfirmOpen(true)}
                          className="text-red-600 dark:text-red-400"
                        >
                          Cancel subscription
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {/* API Usage */}
              <div className="py-2 border-t border-border">
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground">API Usage (This Month)</h3>

                  {/* Monthly Usage Progress */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xl font-semibold text-foreground">
                        ${monthlySpending !== null ? monthlySpending.toFixed(4) : '0.0000'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        of ${usageStatus?.limit.toFixed(2) || '0.00'}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    {usageStatus && (
                      <div className="space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${
                              usageStatus.exceeded
                                ? 'bg-red-500'
                                : usageStatus.warning
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(usageStatus.percentage, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className={
                            usageStatus.exceeded
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : usageStatus.warning
                              ? 'text-yellow-600 dark:text-yellow-400 font-medium'
                              : 'text-muted-foreground'
                          }>
                            {usageStatus.percentage.toFixed(1)}% used
                          </span>
                          <span className="text-muted-foreground">
                            ${usageStatus.remaining.toFixed(4)} remaining
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* All-time total */}
                  <div className="pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>All-time total:</span>
                      <span className="font-medium">${totalSpending !== null ? totalSpending.toFixed(4) : '0.0000'}</span>
                    </div>
                  </div>

                  {/* Warning messages */}
                  {usageStatus?.exceeded && (
                    <div className="rounded-md bg-red-500/10 border border-red-500/20 p-2.5">
                      <p className="text-xs text-red-600 dark:text-red-400">
                        ⚠️ You&rsquo;ve exceeded your monthly limit. Upgrade your plan to continue using the service.
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 95 && !usageStatus?.exceeded && (
                    <div className="rounded-md bg-orange-500/10 border border-orange-500/20 p-2.5">
                      <p className="text-xs text-orange-600 dark:text-orange-400">
                        ⚡ Cost-saving mode: Only GPT OSS 20b is available (95%+ usage)
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 90 && (usageStatus?.percentage ?? 0) < 95 && (
                    <div className="rounded-md bg-orange-500/10 border border-orange-500/20 p-2.5">
                      <p className="text-xs text-orange-600 dark:text-orange-400">
                        ⚡ Cost-saving mode: Only GPT 5 Nano and GPT OSS 20b are available (90%+ usage)
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 85 && (usageStatus?.percentage ?? 0) < 90 && (
                    <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-2.5">
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        ⚡ Cost-saving mode: GPT 5 Mini is disabled (85%+ usage)
                      </p>
                    </div>
                  )}
                  {(usageStatus?.percentage ?? 0) >= 80 && (usageStatus?.percentage ?? 0) < 85 && (
                    <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-2.5">
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        ⚡ Cost-saving mode: GPT 5.2 and GPT 5.2 Pro are disabled (80%+ usage)
                      </p>
                    </div>
                  )}
                  {usageStatus?.warning && (usageStatus?.percentage ?? 0) < 80 && (
                    <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-2.5">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        ⚠️ You&rsquo;re approaching your monthly limit. Consider upgrading your plan.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {tokenAuth ? (
                <div className="space-y-2 py-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Authentication token</Label>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyToken}
                        disabled={!tokenKey || tokenLoading}
                        className="h-7 w-7 p-0"
                        aria-label="Copy token"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTokenVisible((prev) => !prev)}
                        disabled={!tokenKey || tokenLoading}
                        className="h-7 w-7 p-0"
                        aria-label={tokenVisible ? "Hide token" : "Show token"}
                      >
                        {tokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs">
                    {tokenLoading
                      ? "Loading token..."
                      : tokenKey
                      ? tokenVisible
                        ? tokenKey
                        : "•".repeat(Math.max(12, tokenKey.length))
                      : "Token not available"}
                  </div>
                  {copyStatus === "copied" && (
                    <p className="text-xs text-muted-foreground">Token copied to clipboard.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 py-2 border-t border-border">
                  <div>
                    <Label className="text-xs text-muted-foreground">Email</Label>
                    <p className="text-sm text-foreground mt-0.5">{email || 'Not available'}</p>
                  </div>
                  {fullName && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <p className="text-sm text-foreground mt-0.5">{fullName}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          </div>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Cancel subscription?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Are you sure you want to cancel your subscription? You will keep access until your current period ends{planDetails?.renewalDate ? ` (${new Date(planDetails.renewalDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}).` : '.'}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setCancelConfirmOpen(false)}
                  disabled={cancelProcessing}
                >
                  Keep subscription
                </Button>
                <Button
                  variant="destructive"
                  className="hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                  onClick={handleCancelSubscription}
                  disabled={cancelProcessing}
                >
                  {cancelProcessing ? "Canceling..." : "Cancel subscription"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Result Dialog */}
      {cancelResultDialog.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {cancelResultDialog.success ? "Subscription Canceled" : "Error"}
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {cancelResultDialog.message}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  onClick={() => setCancelResultDialog({ open: false, message: "", success: false })}
                >
                  OK
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Chats Confirmation Dialog */}
      {deleteAllChatsConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl pointer-events-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Delete all chats?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Are you sure you want to delete all your chat conversations? This action cannot be undone.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteAllChatsConfirmOpen(false)}
                  disabled={deleteAllChatsProcessing}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                  onClick={handleDeleteAllChats}
                  disabled={deleteAllChatsProcessing}
                >
                  {deleteAllChatsProcessing ? "Deleting..." : "Delete all"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <ImportModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onDone={() => {
          setIsImportOpen(false)
          refreshChats()
        }}
        onRefreshChats={refreshChats}
      />
    </div>
  )
}
