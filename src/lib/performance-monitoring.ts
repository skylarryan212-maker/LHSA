// Performance monitoring and Real User Monitoring (RUM) utilities
// Tracks CPU time, long tasks, and key web vitals

export type PerformanceMetric = {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  timestamp: number;
};

export type LongTask = {
  duration: number;
  startTime: number;
  attribution: string;
};

let performanceObserver: PerformanceObserver | null = null;
let longTaskObserver: PerformanceObserver | null = null;
const longTasks: LongTask[] = [];
const metrics: PerformanceMetric[] = [];

// Thresholds based on Web Vitals
const THRESHOLDS = {
  FCP: { good: 1800, poor: 3000 },
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
};

function getRating(metric: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[metric as keyof typeof THRESHOLDS];
  if (!threshold) return 'good';
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

// Initialize performance monitoring
export function initPerformanceMonitoring(options: {
  onMetric?: (metric: PerformanceMetric) => void;
  onLongTask?: (task: LongTask) => void;
  trackLongTasks?: boolean;
  trackWebVitals?: boolean;
} = {}) {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return () => {};
  }

  const { onMetric, onLongTask, trackLongTasks = true, trackWebVitals = true } = options;

  // Track Web Vitals
  if (trackWebVitals) {
    try {
      performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const metric: PerformanceMetric = {
            name: entry.name || entry.entryType,
            value: entry.startTime + (entry.duration || 0),
            rating: getRating(entry.name || entry.entryType, entry.startTime + (entry.duration || 0)),
            timestamp: Date.now(),
          };
          metrics.push(metric);
          onMetric?.(metric);
        }
      });

      // Observe paint and navigation timing
      performanceObserver.observe({ 
        entryTypes: ['paint', 'navigation', 'largest-contentful-paint', 'first-input', 'layout-shift'] 
      });
    } catch (error) {
      console.warn('Failed to initialize performance observer:', error);
    }
  }

  // Track long tasks (>50ms blocking)
  if (trackLongTasks) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const task: LongTask = {
            duration: entry.duration,
            startTime: entry.startTime,
            attribution: (entry as any).attribution?.[0]?.name || 'unknown',
          };
          longTasks.push(task);
          onLongTask?.(task);

          // Log warning for very long tasks
          if (entry.duration > 100) {
            console.warn(`Long task detected: ${entry.duration.toFixed(2)}ms`, task);
          }
        }
      });

      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      console.warn('Failed to initialize long task observer:', error);
    }
  }

  // Cleanup function
  return () => {
    performanceObserver?.disconnect();
    longTaskObserver?.disconnect();
    performanceObserver = null;
    longTaskObserver = null;
  };
}

// Get all collected metrics
export function getMetrics(): PerformanceMetric[] {
  return [...metrics];
}

// Get all long tasks
export function getLongTasks(): LongTask[] {
  return [...longTasks];
}

// Get CPU time estimate
export function getCPUTime(): number {
  const longTaskTotal = longTasks.reduce((sum, task) => sum + task.duration, 0);
  return longTaskTotal;
}

// Get memory usage (if available)
export function getMemoryUsage(): { usedJSHeapSize?: number; totalJSHeapSize?: number; limit?: number } | null {
  if (typeof window === 'undefined') return null;
  
  const performance = (window as any).performance;
  if (!performance || !performance.memory) return null;
  
  return {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    limit: performance.memory.jsHeapSizeLimit,
  };
}

// Clear all collected data
export function clearMetrics() {
  metrics.length = 0;
  longTasks.length = 0;
}

// Export performance report
export function exportReport() {
  return {
    metrics: getMetrics(),
    longTasks: getLongTasks(),
    cpuTime: getCPUTime(),
    memory: getMemoryUsage(),
    timestamp: Date.now(),
  };
}
