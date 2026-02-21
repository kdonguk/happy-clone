import { spawn, type ChildProcess } from 'node:child_process'

type OutputHandler = (data: string) => void
type ExitHandler = (code: number) => void

export class ProcessBridge {
  private proc: ChildProcess
  private outputHandlers: OutputHandler[] = []
  private exitHandlers: ExitHandler[] = []

  constructor(command: string, args: string[], cwd?: string) {
    this.proc = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, CLAUDECODE: '' } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const handler of this.outputHandlers) handler(text)
    })

    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const handler of this.outputHandlers) handler(text)
    })

    this.proc.on('exit', (code) => {
      for (const handler of this.exitHandlers) handler(code ?? 1)
    })
  }

  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler)
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler)
  }

  write(data: string): void {
    this.proc.stdin?.write(data)
  }

  resize(_cols: number, _rows: number): void {
    // No-op for child_process (no PTY)
  }

  kill(): void {
    this.proc.kill()
  }

  get pid(): number {
    return this.proc.pid ?? -1
  }
}
