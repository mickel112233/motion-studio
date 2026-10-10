export {};
declare global {
  interface Window {
    motionStudio?: {
      listProviders: () => Promise<Array<{ id: string; name: string; kind: 'openai-compatible' | 'anthropic' | 'gemini'; baseUrl: string; model: string; hasApiKey: boolean; updatedAt: string }>>;
      saveProvider: (provider: { id?: string; name: string; kind: 'openai-compatible' | 'anthropic' | 'gemini'; baseUrl: string; model: string; apiKey?: string }) => Promise<{ id: string; name: string; kind: 'openai-compatible' | 'anthropic' | 'gemini'; baseUrl: string; model: string; hasApiKey: boolean; updatedAt: string }>;
      deleteProvider: (id: string) => Promise<{ deleted: boolean }>;
      testProvider: (id: string) => Promise<{ ok: boolean; message: string }>;
      askProvider: (input: { id: string; prompt: string; projectContext: string }) => Promise<{ ok: boolean; text: string }>;
      isDesktop: boolean;
      saveProject: (project: unknown) => Promise<{ canceled: boolean; conflict?: boolean; filePath?: string; data?: unknown }>;
      saveProjectAs: (project: unknown) => Promise<{ canceled: boolean; conflict?: boolean; filePath?: string }>;
      autosaveProject: (project: unknown) => Promise<{ saved: boolean; recovery?: boolean; conflict?: boolean; filePath?: string; data?: unknown }>;
      getRecoveryProject: () => Promise<{ available: boolean; filePath?: string; modifiedAt?: string; data?: unknown }>;
      discardRecoveryProject: () => Promise<{ discarded: boolean }>;
      acceptExternalProject: () => Promise<{ accepted: boolean; filePath?: string }>;
      openProject: () => Promise<{ canceled: boolean; filePath?: string; data?: unknown }>;
      importMedia: () => Promise<Array<{ name: string; path: string; url: string }>>;
      onProjectExternalChange: (callback: (payload: { filePath: string; data?: unknown; error?: string }) => void) => () => void;
    };
  }
}
