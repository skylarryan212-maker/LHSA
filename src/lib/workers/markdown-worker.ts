// Markdown processing Web Worker
// Offloads markdown parsing and syntax highlighting from the main thread

import ReactDOMServer from 'react-dom/server';

// Message types
type WorkerMessage = 
  | { type: 'parse'; id: string; markdown: string; }
  | { type: 'cancel'; id: string; };

type WorkerResponse =
  | { type: 'result'; id: string; html: string; }
  | { type: 'error'; id: string; error: string; };

// Track active parsing tasks
const activeTasks = new Map<string, boolean>();

// Simple markdown to HTML converter (placeholder - can be enhanced with full markdown library)
function parseMarkdown(markdown: string): string {
  let html = markdown;
  
  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'plaintext';
    return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
  });
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Paragraphs
  html = html.split('\n\n').map(para => {
    if (para.match(/^<(h[1-6]|pre|code)/)) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  
  return html;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Handle incoming messages
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  
  if (message.type === 'cancel') {
    activeTasks.delete(message.id);
    return;
  }
  
  if (message.type === 'parse') {
    const { id, markdown } = message;
    activeTasks.set(id, true);
    
    try {
      // Check if task was cancelled
      if (!activeTasks.has(id)) {
        return;
      }
      
      const html = parseMarkdown(markdown);
      
      // Check again before sending result
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'result',
          id,
          html,
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    } catch (error) {
      if (activeTasks.has(id)) {
        const response: WorkerResponse = {
          type: 'error',
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        self.postMessage(response);
        activeTasks.delete(id);
      }
    }
  }
};

export {};
