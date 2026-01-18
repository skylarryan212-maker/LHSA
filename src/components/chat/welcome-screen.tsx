'use client'

interface WelcomeScreenProps {
  shouldUseCenteredComposer: boolean
  emptyStateTransform?: string
  emptyStatePaddingTop?: string
  emptyStateJustifyClass: string
  centeredComposerRef?: React.Ref<HTMLDivElement>
}

export function WelcomeScreen({
  shouldUseCenteredComposer,
  emptyStateTransform,
  emptyStatePaddingTop,
  emptyStateJustifyClass,
  centeredComposerRef,
}: WelcomeScreenProps) {
  return (
    <div
      className={`flex flex-1 flex-col items-center ${emptyStateJustifyClass} gap-6 px-4 text-center ${
        shouldUseCenteredComposer ? 'transition-transform duration-300 ease-out' : ''
      }`}
      style={{
        ...(emptyStateTransform ? { transform: emptyStateTransform } : {}),
        ...(emptyStatePaddingTop ? { paddingTop: emptyStatePaddingTop } : {}),
      }}
    >
      <div className="w-full max-w-4xl relative z-10">
        <h1 className="text-4xl sm:text-5xl font-bold gradient-text tracking-tight">
          Quarry
        </h1>
      </div>

      {/* Centered Composer Placeholder */}
      {shouldUseCenteredComposer && (
        <div ref={centeredComposerRef} className="w-full max-w-3xl" aria-hidden="true" />
      )}
    </div>
  )
}
