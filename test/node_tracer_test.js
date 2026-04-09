const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')

function runTrace(args) {
  return new Promise((resolve, reject) => {
    execFile('node', args, { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

test('trace-node writes JSONL trace with summary and async events', async () => {
  const projectRoot = path.resolve(__dirname, '..')
  const outputFile = path.join(projectRoot, 'test', 'tmp_hello_world.js.trace')
  const entryFile = path.join(projectRoot, 'examples', 'hello_world.js')
  const traceCli = path.join(projectRoot, 'bin', 'trace-node')

  try {
    await runTrace([traceCli, entryFile, outputFile, '--wait-ms=50'])

    assert.equal(fs.existsSync(outputFile), true, 'trace file should exist')

    const lines = fs.readFileSync(outputFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    assert.ok(lines.length > 1, 'trace file should contain multiple events')
    assert.equal(lines[lines.length - 1].event, 'trace_summary', 'last event should be summary')
    const executionEvents = lines.filter((entry) => entry.app_code && (entry.event === 'line' || entry.event === 'call' || entry.event === 'return'))
    assert.ok(executionEvents.length >= 5, 'should include multiple app execution events')
    assert.ok(lines.some((entry) => entry.event === 'async_init'), 'should include async init events')
  } finally {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile)
    }
  }
})
