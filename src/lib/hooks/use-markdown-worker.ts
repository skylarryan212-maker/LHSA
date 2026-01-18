// Hook for using the markdown worker
import { useEffect, useRef, useState, useCallback } from 'react';

type WorkerMessage = 
  | { type: 'parse'; id: string; markdown: string; }
  | { type: 'cancel'; id: string; };

type WorkerResponse =
  | { type: 'result'; id: string; html: string; }
  | { type: 'error'; id: string; error: string; };

export function useMarkdownWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const callbacksRef = useRef<Map<string, (html: string, error?: string) => void>>(new Map());

  useEffect(() => {
    // Initialize worker
    if (typeof window !== 'undefined' && !workerRef.current) {
      try {
        const workerUrl = new URL('../workers/markdown-worker.ts', window.location.href);
        workerRef.current = new Worker(workerUrl, { type: 'module' });

        workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const response = event.data;
          const callback = callbacksRef.current.get(response.id);
          
          if (callback) {
            if (response.type === 'result') {
              callback(response.html);
            } else if (response.type === 'error') {
              callback('', response.error);
            }
            callbacksRef.current.delete(response.id);
          }
        };

        workerRef.current.onerror = (error) => {
          console.error('Markdown worker error:', error);
        };

        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize markdown worker:', error);
        setIsReady(false);
      }
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      callbacksRef.current.clear();
    };
  }, []);

  const parseMarkdown = useCallback((markdown: string, callback: (html: string, error?: string) => void) => {
    if (!workerRef.current || !isReady) {
      // Fallback to main thread if worker not available
      callback(markdown);
      return null;
    }

    const id = `${Date.now()}-${Math.random()}`;
    callbacksRef.current.set(id, callback);

    const message: WorkerMessage = {
      type: 'parse',
      id,
      markdown,
    };

    workerRef.current.postMessage(message);

    // Return cancel function
    return () => {
      if (workerRef.current) {
        const cancelMessage: WorkerMessage = { type: 'cancel', id };
        workerRef.current.postMessage(cancelMessage);
      }
      callbacksRef.current.delete(id);
    };
  }, [isReady]);

  return { parseMarkdown, isReady };
}
