// Public local evidence only; this process never receives API or login credentials.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { Config } from './config';

export const EVIDENCE_CORPUS_VERSION = 'ca1729f26aee90931ae7571749816dbebbb0ccf2e2810f56d70f900d6ac855c9';
export type EvidenceTool = 'search_evidence' | 'get_evidence' | 'get_content_review_status';
export type EvidenceRunner = (tool: EvidenceTool, args: Record<string, unknown>) => Promise<unknown>;

export function evidenceRunner(config: Config): EvidenceRunner {
  return async (tool, args) => {
    if (!config.evidence) throw new Error('EVIDENCE_DISABLED: explicit local evidence configuration is required');
    const evidence = config.evidence;
    const input = JSON.stringify({ config: evidence, tool, args });
    return await new Promise((resolve, reject) => {
      const child = execFile(evidence.localPython, ['-B', join(config.repoRoot, 'tools/content-pipeline/mcp_evidence.py')], {
        timeout: 120_000, maxBuffer: 160_000, windowsHide: true,
        env: { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8',
          HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
          TOKENIZERS_PARALLELISM: 'false', PYTHONDONTWRITEBYTECODE: '1', DOCKER_HOST: 'unix:///var/run/docker.sock' },
      }, (error, stdout) => {
        if (error) return reject(new Error('EVIDENCE_REQUEST_REFUSED'));
        try {
          const result = JSON.parse(stdout) as { ok: boolean; value?: unknown };
          if (result.ok !== true) return reject(new Error('EVIDENCE_REQUEST_REFUSED'));
          resolve(result.value);
        } catch { reject(new Error('EVIDENCE_REQUEST_REFUSED')); }
      });
      child.stdin?.end(input);
    });
  };
}
