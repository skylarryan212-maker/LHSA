'use client';

import { useEffect } from 'react';
import { initPerformanceMonitoring } from '@/lib/performance-monitoring';

export function PerformanceMonitor() {
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production') {
      return;
    }

    const cleanup = initPerformanceMonitoring({
      onMetric: (metric) => {
        // Log to console in dev, send to analytics in production
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Performance] ${metric.name}: ${metric.value.toFixed(2)}ms (${metric.rating})`);
        }
        // In production, you could send to analytics service:
        // analytics.track('web_vital', metric);
      },
      onLongTask: (task) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[Long Task] ${task.duration.toFixed(2)}ms from ${task.attribution}`);
        }
        // In production:
        // analytics.track('long_task', task);
      },
      trackLongTasks: true,
      trackWebVitals: true,
    });

    return cleanup;
  }, []);

  return null;
}
