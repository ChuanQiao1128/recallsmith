// Types of scripts/buildLib.mjs for the tests.

export function runSurfaceScript(script: string, root: string): string;

export function buildMcpServer(options: {
  root: string;
  outDir?: string;
  listSurface?: (script: string, root: string) => string | Promise<string>;
}): Promise<void>;
