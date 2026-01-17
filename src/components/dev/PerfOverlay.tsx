'use client';

import React, { memo, useCallback, useEffect, useState } from 'react';
import { PERF_CONFIG, perfCounters, type PerfMetrics } from '@/lib/perf';

/**
 * Dev-only performance overlay that shows real-time metrics.
 * Only renders when DEV_PERF_MODE is enabled.
 */
export const PerfOverlay = memo(function PerfOverlay() {
  const [isVisible, setIsVisible] = useState(false);
  const [metrics, setMetrics] = useState<PerfMetrics | null>(null);
  const [isMinimized, setIsMinimized] = useState(true);

  // Toggle visibility with keyboard shortcut
  useEffect(() => {
    if (!PERF_CONFIG.DEV_PERF_MODE) return;

    const handleKeydown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + P to toggle
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setIsVisible(v => !v);
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  // Update metrics every 500ms when visible
  useEffect(() => {
    if (!isVisible) return;

    const update = () => setMetrics(perfCounters.getMetrics());
    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [isVisible]);

  const handleExport = useCallback(() => {
    const json = perfCounters.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perf-metrics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleReset = useCallback(() => {
    perfCounters.reset();
    setMetrics(perfCounters.getMetrics());
  }, []);

  if (!PERF_CONFIG.DEV_PERF_MODE || !isVisible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        zIndex: 99999,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#00ff88',
        borderRadius: 8,
        padding: isMinimized ? '6px 12px' : '12px 16px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
        minWidth: isMinimized ? 120 : 200,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setIsMinimized(m => !m)}
    >
      {isMinimized ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#00ff88' }}>⚡</span>
          <span>{metrics?.tokensPerSecond ?? 0} tok/s</span>
          <span style={{ color: '#888' }}>|</span>
          <span>{metrics?.uiCommitsPerSecond ?? 0} UI/s</span>
        </div>
      ) : (
        <div onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚡ Performance</span>
            <button
              onClick={() => setIsMinimized(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              −
            </button>
          </div>
          
          <table style={{ width: '100%', borderSpacing: '4px 2px' }}>
            <tbody>
              <tr>
                <td style={{ color: '#888' }}>Tokens/sec</td>
                <td style={{ textAlign: 'right' }}>{metrics?.tokensPerSecond ?? 0}</td>
              </tr>
              <tr>
                <td style={{ color: '#888' }}>UI commits/sec</td>
                <td style={{ textAlign: 'right' }}>{metrics?.uiCommitsPerSecond ?? 0}</td>
              </tr>
              <tr>
                <td style={{ color: '#888' }}>Avg batch size</td>
                <td style={{ textAlign: 'right' }}>{metrics?.avgBatchSize ?? 0}</td>
              </tr>
              <tr>
                <td style={{ color: '#888' }}>Rerenders/tok</td>
                <td style={{ textAlign: 'right' }}>{metrics?.listRerendersPerToken ?? 0}</td>
              </tr>
              <tr>
                <td style={{ color: '#888', paddingTop: 6 }}>Total tokens</td>
                <td style={{ textAlign: 'right', paddingTop: 6 }}>{metrics?.totalTokens ?? 0}</td>
              </tr>
              <tr>
                <td style={{ color: '#888' }}>Total commits</td>
                <td style={{ textAlign: 'right' }}>{metrics?.totalCommits ?? 0}</td>
              </tr>
            </tbody>
          </table>
          
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button
              onClick={handleExport}
              style={{
                flex: 1,
                padding: '4px 8px',
                background: '#333',
                border: '1px solid #555',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Export JSON
            </button>
            <button
              onClick={handleReset}
              style={{
                flex: 1,
                padding: '4px 8px',
                background: '#333',
                border: '1px solid #555',
                borderRadius: 4,
                color: '#ff8888',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Reset
            </button>
          </div>
          
          <div style={{ marginTop: 8, fontSize: 9, color: '#666' }}>
            Press Ctrl+Shift+P to toggle
          </div>
        </div>
      )}
    </div>
  );
});

PerfOverlay.displayName = 'PerfOverlay';

export default PerfOverlay;
