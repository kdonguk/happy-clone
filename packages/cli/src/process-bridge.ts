import * as pty from 'node-pty'

type OutputHandler = (data: string) => void
type ExitHandler = (code: number) => void

export class ProcessBridge {
  private proc: pty.IPty
  private outputHandlers: OutputHandler[] = []
  private exitHandlers: ExitHandler[] = []

  constructor(command: string, args: string[], cwd?: string) {
    this.proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: cwd ?? process.cwd(),
    })

    this.proc.onData((data) => {
      for (const handler of this.outputHandlers) handler(data)
    })

    this.proc.onExit(({ exitCode }) => {
      for (const handler of this.exitHandlers) handler(exitCode)
    })
  }

  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler)
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler)
  }

  write(data: string): void {
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    this.proc.resize(cols, rows)
  }

  kill(): void {
    this.proc.kill()
  }

  get pid(): number {
    return this.proc.pid
  }
}
