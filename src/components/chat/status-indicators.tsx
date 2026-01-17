'use client';

import React, { memo, useMemo } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Memoized Status Indicator Components
// These are isolated from the main message list to prevent re-renders
// ─────────────────────────────────────────────────────────────────────────────

export type RuntimeIndicatorVariant = 
  | 'default' 
  | 'extended' 
  | 'search' 
  | 'reading' 
  | 'analyzing' 
  | 'compacting'
  | 'compaction-complete'
  | 'error' 
  | 'warning';

export interface RuntimeIndicatorState {
  label: string;
  variant: RuntimeIndicatorVariant;
  subtext?: string;
}

const RUNTIME_INDICATOR_GRADIENTS: Record<RuntimeIndicatorVariant, { center: string; side: string }> = {
  default: { center: 'rgba(255, 255, 255, 0.95)', side: 'rgba(255, 255, 255, 0.25)' },
  extended: { center: 'rgba(183, 198, 255, 0.95)', side: 'rgba(138, 180, 255, 0.35)' },
  search: { center: 'rgba(155, 184, 255, 0.95)', side: 'rgba(75, 100, 255, 0.25)' },
  reading: { center: 'rgba(184, 255, 232, 0.95)', side: 'rgba(83, 242, 199, 0.25)' },
  analyzing: { center: 'rgba(221, 214, 254, 0.95)', side: 'rgba(196, 181, 253, 0.3)' },
  compacting: { center: 'rgba(255, 200, 120, 0.95)', side: 'rgba(255, 165, 60, 0.35)' },
  'compaction-complete': { center: 'rgba(120, 255, 180, 0.95)', side: 'rgba(60, 220, 140, 0.35)' },
  error: { center: 'rgba(255, 103, 135, 0.95)', side: 'rgba(255, 103, 135, 0.35)' },
  warning: { center: 'rgba(255, 210, 116, 0.95)', side: 'rgba(255, 210, 116, 0.35)' },
};

interface RuntimeIndicatorProps {
  state: RuntimeIndicatorState | null;
}

/**
 * Memoized runtime indicator component.
 * Only re-renders when the indicator state actually changes.
 */
export const RuntimeIndicator = memo(function RuntimeIndicator({ state }: RuntimeIndicatorProps) {
  if (!state) return null;

  const gradient = RUNTIME_INDICATOR_GRADIENTS[state.variant];
  const gradientStyle = {
    '--status-wave-color-center': gradient.center,
    '--status-wave-color-side': gradient.side,
  } as React.CSSProperties;

  return (
    <div className="px-1 pb-1 text-white/80">
      <p className="text-base leading-relaxed">
        <span className="inline-block status-wave-text" style={gradientStyle}>
          {state.label}
        </span>
      </p>
      {state.subtext ? (
        <p className="mt-1 text-xs text-white/60">{state.subtext}</p>
      ) : null}
    </div>
  );
});

RuntimeIndicator.displayName = 'RuntimeIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Thinking Indicator
// ─────────────────────────────────────────────────────────────────────────────

interface ThinkingIndicatorProps {
  variant: 'thinking' | 'extended';
  label: string;
}

export const ThinkingIndicator = memo(function ThinkingIndicator({ 
  variant, 
  label 
}: ThinkingIndicatorProps) {
  const indicatorVariant: RuntimeIndicatorVariant = 
    variant === 'extended' ? 'extended' : 'default';
  
  return (
    <RuntimeIndicator 
      state={{ label, variant: indicatorVariant }} 
    />
  );
});

ThinkingIndicator.displayName = 'ThinkingIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Search Indicator
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchIndicatorState {
  message: string;
  variant: 'running' | 'complete' | 'error';
  domains: string[];
  subtext?: string;
}

interface SearchIndicatorProps {
  state: SearchIndicatorState | null;
}

export const SearchIndicator = memo(function SearchIndicator({ 
  state 
}: SearchIndicatorProps) {
  if (!state) return null;

  const indicatorVariant: RuntimeIndicatorVariant = 
    state.variant === 'error' ? 'error' : 'search';
  
  return (
    <RuntimeIndicator 
      state={{ 
        label: state.message, 
        variant: indicatorVariant,
        subtext: state.subtext,
      }} 
    />
  );
});

SearchIndicator.displayName = 'SearchIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// File Reading Indicator
// ─────────────────────────────────────────────────────────────────────────────

interface FileReadingIndicatorProps {
  state: 'running' | 'error' | null;
}

export const FileReadingIndicator = memo(function FileReadingIndicator({ 
  state 
}: FileReadingIndicatorProps) {
  if (!state) return null;

  return (
    <RuntimeIndicator 
      state={{ 
        label: 'Reading documents', 
        variant: state === 'error' ? 'error' : 'reading',
      }} 
    />
  );
});

FileReadingIndicator.displayName = 'FileReadingIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Analyzing Indicator
// ─────────────────────────────────────────────────────────────────────────────

interface AnalyzingIndicatorProps {
  isAnalyzing: boolean;
}

export const AnalyzingIndicator = memo(function AnalyzingIndicator({ 
  isAnalyzing 
}: AnalyzingIndicatorProps) {
  if (!isAnalyzing) return null;

  return (
    <RuntimeIndicator 
      state={{ label: 'Analyzing', variant: 'analyzing' }} 
    />
  );
});

AnalyzingIndicator.displayName = 'AnalyzingIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Compaction Indicator
// ─────────────────────────────────────────────────────────────────────────────

interface CompactionIndicatorProps {
  isCompacting: boolean;
  isComplete: boolean;
}

export const CompactionIndicator = memo(function CompactionIndicator({ 
  isCompacting,
  isComplete,
}: CompactionIndicatorProps) {
  if (!isCompacting && !isComplete) return null;

  if (isComplete) {
    return (
      <RuntimeIndicator 
        state={{ 
          label: '✓ Context compacted', 
          variant: 'compaction-complete',
          subtext: 'Memory optimized for continued conversation',
        }} 
      />
    );
  }

  return (
    <RuntimeIndicator 
      state={{ 
        label: 'Compacting context...', 
        variant: 'compacting',
        subtext: 'Summarizing conversation history to free up space',
      }} 
    />
  );
});

CompactionIndicator.displayName = 'CompactionIndicator';

export default {
  RuntimeIndicator,
  ThinkingIndicator,
  SearchIndicator,
  FileReadingIndicator,
  AnalyzingIndicator,
  CompactionIndicator,
};
