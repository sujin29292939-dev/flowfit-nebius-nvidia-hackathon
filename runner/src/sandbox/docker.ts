// sandbox/docker.ts
import { exec }       from "node:child_process";
import { promisify }  from "node:util";
import fs             from "node:fs/promises";

const execAsync = promisify(exec);

export interface ExecResult { stdout: string; stderr: string; exitCode: number }

export class DockerSandbox {
  private containerId: string | null = null;
  readonly workspacePath: string;
  readonly containerWorkspace = "/workspace";

  constructor(readonly sessionId: string) {
    this.workspacePath = `/tmp/flowfit-sessions/${sessionId}`;
  }

  async start(): Promise<void> {
    await fs.mkdir(this.workspacePath, { recursive: true });
    const { stdout } = await execAsync([
      "docker run -d --rm",
      `--name ff-${this.sessionId.slice(0, 8)}`,
      `-v ${this.workspacePath}:${this.containerWorkspace}`,
      `-w ${this.containerWorkspace}`,
      "--memory=2g --cpus=1",
      "--security-opt no-new-privileges",
      "ubuntu:22.04 tail -f /dev/null",
    ].join(" "));
    this.containerId = stdout.trim();
    await this.exec("apt-get update -qq && apt-get install -y -qq curl python3 nodejs 2>/dev/null || true");
  }

  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    if (!this.containerId) throw new Error("Sandbox not started");
    try {
      const { stdout, stderr } = await execAsync(
        `docker exec ${this.containerId} bash -c ${JSON.stringify(command)}`,
        { timeout: timeoutMs }
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(err), exitCode: e.code ?? 1 };
    }
  }

  async listWorkspaceFiles(): Promise<string[]> {
    const result = await this.exec("find . -type f | sort | head -100");
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  async stop(): Promise<void> {
    if (!this.containerId) return;
    try { await execAsync(`docker stop ${this.containerId}`); } catch { /* already stopped */ }
    this.containerId = null;
  }
}
