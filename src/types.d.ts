export {};
declare global {
  interface Window {
    motionStudio?: {
      isDesktop: boolean;
      saveProject: (project: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
      saveProjectAs: (project: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
      openProject: () => Promise<{ canceled: boolean; filePath?: string; data?: unknown }>;
      importMedia: () => Promise<Array<{ name: string; path: string; url: string }>>;
      onProjectExternalChange: (callback: (payload: { filePath: string; data?: unknown; error?: string }) => void) => () => void;
    };
  }
}
