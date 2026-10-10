export {};
declare global {
  interface Window {
    motionStudio?: {
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
