import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { ProcessBridge } from '../process-bridge.js'

describe('ProcessBridge', () => {
  let bridge: ProcessBridge | null = null

  after(() => {
    bridge?.kill()
    bridge = null
  })

  it('should spawn a process and emit output', async () => {
    bridge = new ProcessBridge('echo', ['hello'])
    const output = await new Promise<string>((resolve) => {
      bridge!.onOutput((data) => resolve(data))
    })
    assert.match(output, /hello/)
  })

  it('should send input to process', async () => {
    bridge = new ProcessBridge('cat', [])
    const output = new Promise<string>((resolve) => {
      bridge!.onOutput((data) => {
        if (data.includes('test-input')) resolve(data)
      })
    })
    bridge.write('test-input\n')
    const result = await output
    assert.match(result, /test-input/)
  })

  it('should emit exit event', async () => {
    bridge = new ProcessBridge('echo', ['done'])
    const code = await new Promise<number>((resolve) => {
      bridge!.onExit((exitCode) => resolve(exitCode))
    })
    assert.equal(code, 0)
  })
})
