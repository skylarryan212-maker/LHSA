// Message reconciliation and diffing Web Worker
// Offloads heavy array diffing and message state reconciliation from main thread

type Message = {
  id: string;
  content: string;
  role: string;
  [key: string]: any;
};

type WorkerMessage =
  | { type: 'reconcile'; id: string; currentMessages: Message[]; newMessages: Message[]; }
  | { type: 'diff'; id: string; oldArray: any[]; newArray: any[]; }
  | { type: 'cancel'; id: string; };

type WorkerResponse =
  | { type: 'reconcile-result'; id: string; mergedMessages: Message[]; }
  | { type: 'diff-result'; id: string; added: any[]; removed: any[]; updated: any[]; }
  | { type: 'error'; id: string; error: string; };

const activeTasks = new Map<string, boolean>();

// Reconcile message arrays - merge new messages with existing, preserving streaming state
function reconcileMessages(current: Message[], incoming: Message[]): Message[] {
  const messageMap = new Map<string, Message>();
  
  // Add all current messages
  current.forEach(msg => {
    messageMap.set(msg.id, msg);
  });
  
  // Update/add incoming messages
  incoming.forEach(msg => {
    const existing = messageMap.get(msg.id);
    if (existing) {
      // Merge: keep streaming state from current if exists, update content from incoming
      messageMap.set(msg.id, { ...existing, ...msg });
    } else {
      messageMap.set(msg.id, msg);
    }
  });
  
  return Array.from(messageMap.values()).sort((a, b) => {
    // Sort by created_at or fallback to insertion order
    const timeA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
    const timeB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
    return timeA - timeB;
  });
}

// Compute diff between two arrays
function computeDiff<T extends { id: string }>(oldArray: T[], newArray: T[]) {
  const oldMap = new Map(oldArray.map(item => [item.id, item]));
  const newMap = new Map(newArray.map(item => [item.id, item]));
  
  const added: T[] = [];
  const removed: T[] = [];
  const updated: T[] = [];
  
  // Find added and updated
  newArray.forEach(newItem => {
    const oldItem = oldMap.get(newItem.id);
    if (!oldItem) {
      added.push(newItem);
    } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
      updated.push(newItem);
    }
  });
  
  // Find removed
  oldArray.forEach(oldItem => {
    if (!newMap.has(oldItem.id)) {
      removed.push(oldItem);
    }
  });
  
  return { added, removed, updated };
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  
  if (message.type === 'cancel') {
    activeTasks.delete(message.id);
    return;
  }
  
  if (message.type === 'reconcile') {
    const { id, currentMessages, newMessages } = message;
    activeTasks.set(id, true);
    
    try {
      if (!activeTasks.has(id)) return;
      
      const mergedMessages = reconcileMessages(currentMessages, newMessages);
      
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'reconcile-result',
          id,
          mergedMessages,
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    } catch (error) {
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'error',
          id,
          error: error instanceof Error ? error.message : 'Reconciliation error',
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    }
  }
  
  if (message.type === 'diff') {
    const { id, oldArray, newArray } = message;
    activeTasks.set(id, true);
    
    try {
      if (!activeTasks.has(id)) return;
      
      const { added, removed, updated } = computeDiff(oldArray, newArray);
      
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'diff-result',
          id,
          added,
          removed,
          updated,
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    } catch (error) {
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'error',
          id,
          error: error instanceof Error ? error.message : 'Diff error',
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    }
  }
};

export {};
