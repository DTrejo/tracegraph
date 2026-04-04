'use strict'

const asyncHooks = require('node:async_hooks')
const fs = require('node:fs')
const inspector = require('node:inspector')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')

const DEFAULT_MAX_VALUE_LENGTH = 200
const DEFAULT_WAIT_MS = 100

class NodeExecutionTracer {
  constructor(outputFile, options = {}) {
    this.outputFile = outputFile
    this.maxValueLength = options.max_value_length || DEFAULT_MAX_VALUE_LENGTH
    this.waitMs = options.wait_ms || DEFAULT_WAIT_MS
    this.traceNodeModules = options.trace_node_modules || false

    this.appPaths = (options.app_paths || []).map((p) => path.resolve(p))
    this.traceId = 0
    this.fileDescriptor = fs.openSync(outputFile, 'w')

    this.methodsSeen = new Set()
    this.appFilesTouched = new Set()
    this.externalFilesTouched = new Set()
    this.scriptInfoById = new Map()
    this.asyncResources = new Map()
    this.pendingAsyncEvents = []
    this.errors = []
    this.breakpointsInstalledScriptIds = new Set()

    this.startedStepping = false
    this.stopRequested = false
    this.previousAppFrame = null
    this.pauseChain = Promise.resolve()
    this.scriptParsedChain = Promise.resolve()
    this.currentEntryFile = null
    this.excludedFiles = new Set([path.resolve(__filename)])
  }

  async trace(entryFile) {
    this.currentEntryFile = path.resolve(entryFile)

    if (this.appPaths.length === 0) {
      this.appPaths = [path.dirname(this.currentEntryFile)]
    }

    this.session = new inspector.Session()
    this.session.connect()

    this.installEventHandlers()
    this.installAsyncHook()

    let targetError = null

    try {
      await this.post('Runtime.enable')
      await this.post('Debugger.enable')
      await this.post('Debugger.setAsyncCallStackDepth', { maxDepth: 32 })
      await this.safePost('Debugger.setBlackboxPatterns', {
        patterns: ['^node:', '.*/node_modules/.*']
      })
      await this.post('Debugger.setBreakpointByUrl', {
        lineNumber: 0,
        urlRegex: `${escapeForRegex(this.currentEntryFile)}$`
      })

      try {
        await import(pathToFileURL(this.currentEntryFile).href)
      } catch (error) {
        targetError = error
      }

      await wait(this.waitMs)
    } finally {
      this.stopRequested = true
      await this.pauseChain
      await this.scriptParsedChain
      await this.safePost('Debugger.resume')

      this.asyncHook.disable()
      this.flushAsyncEvents()
      this.writeSummary()

      this.session.disconnect()
      fs.closeSync(this.fileDescriptor)
    }

    if (targetError) {
      throw targetError
    }
  }

  installEventHandlers() {
    this.session.on('Debugger.scriptParsed', ({ params }) => {
      this.scriptParsedChain = this.scriptParsedChain
        .then(() => this.handleScriptParsed(params))
        .catch((error) => this.errors.push(`scriptParsed: ${error.message}`))
    })

    this.session.on('Debugger.paused', ({ params }) => {
      this.pauseChain = this.pauseChain
        .then(() => this.handlePaused(params))
        .catch(async (error) => {
          this.errors.push(`paused: ${error.message}`)
          await this.safePost('Debugger.resume')
        })
    })
  }

  installAsyncHook() {
    this.asyncHook = asyncHooks.createHook({
      init: (asyncId, type, triggerAsyncId) => {
        this.asyncResources.set(asyncId, { type, triggerAsyncId })
        this.enqueueAsyncEvent('async_init', { async_id: asyncId, trigger_async_id: triggerAsyncId, async_type: type })
      },
      before: (asyncId) => {
        this.enqueueAsyncEvent('async_before', this.buildAsyncMeta(asyncId))
      },
      after: (asyncId) => {
        this.enqueueAsyncEvent('async_after', this.buildAsyncMeta(asyncId))
      },
      destroy: (asyncId) => {
        this.enqueueAsyncEvent('async_destroy', this.buildAsyncMeta(asyncId))
      },
      promiseResolve: (asyncId) => {
        this.enqueueAsyncEvent('async_promise_resolve', this.buildAsyncMeta(asyncId))
      }
    })

    this.asyncHook.enable()
  }

  async handleScriptParsed(params) {
    const scriptId = params.scriptId
    const url = params.url || ''
    const filePath = normalizeScriptPath(url)
    const appCode = this.isApplicationCode(filePath)

    const info = {
      scriptId,
      url,
      filePath,
      appCode,
      lines: []
    }

    if (appCode) {
      const sourceResult = await this.safePost('Debugger.getScriptSource', { scriptId })
      if (sourceResult && typeof sourceResult.scriptSource === 'string') {
        info.lines = sourceResult.scriptSource.split(/\r?\n/)
      }
    }

    this.scriptInfoById.set(scriptId, info)
  }

  async handlePaused(params) {
    const callFrames = params.callFrames || []
    if (callFrames.length === 0) {
      await this.safePost('Debugger.resume')
      return
    }

    const topFrame = callFrames[0]
    let scriptInfo = this.scriptInfoById.get(topFrame.location.scriptId)
    if (!scriptInfo) {
      await this.scriptParsedChain
      scriptInfo = this.scriptInfoById.get(topFrame.location.scriptId)
    }

    let filePath = (scriptInfo && scriptInfo.filePath) || normalizeScriptPath(topFrame.url || '')
    if (!filePath && Array.isArray(params.hitBreakpoints) && params.hitBreakpoints.some((id) => id.includes(this.currentEntryFile))) {
      filePath = this.currentEntryFile
    }

    const appCode = this.isApplicationCode(filePath)

    if (this.stopRequested) {
      await this.safePost('Debugger.resume')
      return
    }

    if (!appCode) {
      await this.safePost('Debugger.resume')
      return
    }

    if (!this.startedStepping) {
      await this.ensureLineBreakpoints(topFrame.location.scriptId)
      this.startedStepping = true
    } else {
      this.flushAsyncEvents()
    }

    const stackDepth = callFrames.length
    const eventType = this.determineEventType(topFrame, stackDepth)
    const frameLocals = await this.extractLocals(topFrame)
    const sourceLine = this.getSourceLine(topFrame.location.scriptId, topFrame.location.lineNumber)
    const asyncId = asyncHooks.executionAsyncId()
    const asyncMeta = this.asyncResources.get(asyncId)
    const functionName = topFrame.functionName || '<anonymous>'

    this.methodsSeen.add(functionName)

    if (filePath) {
      this.appFilesTouched.add(filePath)
    }

    const entry = {
      id: this.nextId(),
      timestamp: new Date().toISOString(),
      event: eventType,
      file: filePath ? path.basename(filePath) : '<unknown>',
      file_path: filePath,
      line: topFrame.location.lineNumber + 1,
      column: topFrame.location.columnNumber + 1,
      method: functionName,
      function: functionName,
      app_code: true,
      stack_depth: stackDepth,
      script_id: topFrame.location.scriptId,
      source: sourceLine || undefined,
      reason: params.reason,
      async_stack_id: params.asyncStackTraceId ? params.asyncStackTraceId.id : undefined
    }

    if (asyncId > 0) {
      entry.async_id = asyncId
      if (asyncMeta) {
        entry.trigger_async_id = asyncMeta.triggerAsyncId
        entry.async_type = asyncMeta.type
      }
    }

    if (frameLocals.locals && Object.keys(frameLocals.locals).length > 0) {
      entry.locals = frameLocals.locals
    }

    if (frameLocals.closure_vars && Object.keys(frameLocals.closure_vars).length > 0) {
      entry.closure_vars = frameLocals.closure_vars
    }

    if (frameLocals.this_value) {
      entry.this_value = frameLocals.this_value
    }

    this.writeEntry(entry)

    this.previousAppFrame = {
      callFrameId: topFrame.callFrameId,
      stackDepth,
      lineNumber: topFrame.location.lineNumber,
      functionName
    }

    await this.safePost('Debugger.resume')
  }

  determineEventType(topFrame, stackDepth) {
    if (!this.previousAppFrame) {
      return 'call'
    }

    if (topFrame.callFrameId === this.previousAppFrame.callFrameId) {
      return 'line'
    }

    if (stackDepth > this.previousAppFrame.stackDepth) {
      return 'call'
    }

    if (stackDepth < this.previousAppFrame.stackDepth) {
      return 'line'
    }

    if ((topFrame.functionName || '<anonymous>') !== this.previousAppFrame.functionName) {
      return 'call'
    }

    return 'line'
  }

  async extractLocals(callFrame) {
    const locals = {}
    const closureVars = {}

    for (const scope of callFrame.scopeChain || []) {
      if (!scope.object || !scope.object.objectId) {
        continue
      }

      if (scope.type === 'local' || scope.type === 'block' || scope.type === 'catch') {
        Object.assign(locals, await this.readScopeObject(scope.object.objectId))
      }

      if (scope.type === 'closure') {
        Object.assign(closureVars, await this.readScopeObject(scope.object.objectId))
      }
    }

    return {
      locals: locals,
      closure_vars: closureVars,
      this_value: this.serializeRemoteObject(callFrame.this)
    }
  }

  async ensureLineBreakpoints(scriptId) {
    if (this.breakpointsInstalledScriptIds.has(scriptId)) {
      return
    }

    const scriptInfo = this.scriptInfoById.get(scriptId)
    if (!scriptInfo || !scriptInfo.appCode || !Array.isArray(scriptInfo.lines)) {
      return
    }

    for (let lineNumber = 0; lineNumber < scriptInfo.lines.length; lineNumber += 1) {
      const sourceLine = scriptInfo.lines[lineNumber]
      if (!sourceLine || sourceLine.trim().length === 0) {
        continue
      }

      await this.safePost('Debugger.setBreakpoint', {
        location: {
          scriptId,
          lineNumber,
          columnNumber: 0
        }
      })
    }

    this.breakpointsInstalledScriptIds.add(scriptId)
  }

  async readScopeObject(objectId) {
    const output = {}
    const result = await this.safePost('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: false
    })

    if (!result || !Array.isArray(result.result)) {
      return output
    }

    for (const prop of result.result) {
      if (!prop || typeof prop.name !== 'string') {
        continue
      }

      if (prop.value) {
        output[prop.name] = this.serializeRemoteObject(prop.value)
      } else if (prop.get || prop.set) {
        output[prop.name] = { value: '<accessor>', type: 'accessor', object_id: null }
      }
    }

    return output
  }

  getSourceLine(scriptId, lineNumber) {
    const info = this.scriptInfoById.get(scriptId)
    if (!info || !info.lines || lineNumber < 0 || lineNumber >= info.lines.length) {
      return null
    }

    return info.lines[lineNumber]
  }

  serializeRemoteObject(remoteObject) {
    if (!remoteObject) {
      return null
    }

    if (Object.prototype.hasOwnProperty.call(remoteObject, 'value')) {
      return {
        value: this.formatValue(remoteObject.value),
        type: remoteObject.className || remoteObject.type,
        object_id: remoteObject.objectId || null
      }
    }

    if (remoteObject.unserializableValue) {
      return {
        value: remoteObject.unserializableValue,
        type: remoteObject.className || remoteObject.type,
        object_id: remoteObject.objectId || null
      }
    }

    if (remoteObject.type === 'undefined') {
      return {
        value: 'undefined',
        type: 'undefined',
        object_id: remoteObject.objectId || null
      }
    }

    return {
      value: this.truncate(remoteObject.description || `<${remoteObject.type}>`),
      type: remoteObject.className || remoteObject.type,
      object_id: remoteObject.objectId || null
    }
  }

  formatValue(value) {
    if (typeof value === 'string') {
      return this.truncate(JSON.stringify(value))
    }

    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    if (typeof value === 'undefined') {
      return 'undefined'
    }

    try {
      return this.truncate(JSON.stringify(value))
    } catch (_error) {
      return this.truncate(String(value))
    }
  }

  truncate(value) {
    if (value.length <= this.maxValueLength) {
      return value
    }

    return `${value.slice(0, this.maxValueLength - 3)}...`
  }

  isApplicationCode(filePath) {
    if (!filePath) {
      return false
    }

    const absolutePath = path.resolve(filePath)
    if (this.excludedFiles.has(absolutePath)) {
      return false
    }

    if (!this.traceNodeModules && absolutePath.includes(`${path.sep}node_modules${path.sep}`)) {
      return false
    }

    return this.appPaths.some((appPath) => absolutePath === appPath || absolutePath.startsWith(`${appPath}${path.sep}`))
  }

  buildAsyncMeta(asyncId) {
    const meta = this.asyncResources.get(asyncId)
    return {
      async_id: asyncId,
      trigger_async_id: meta ? meta.triggerAsyncId : null,
      async_type: meta ? meta.type : null
    }
  }

  enqueueAsyncEvent(event, payload) {
    if (!this.startedStepping || this.stopRequested) {
      return
    }

    this.pendingAsyncEvents.push({
      event,
      payload,
      timestamp: new Date().toISOString()
    })
  }

  flushAsyncEvents() {
    while (this.pendingAsyncEvents.length > 0) {
      const item = this.pendingAsyncEvents.shift()
      this.writeEntry({
        id: this.nextId(),
        timestamp: item.timestamp,
        event: item.event,
        app_code: false,
        ...item.payload
      })
    }
  }

  writeSummary() {
    this.writeEntry({
      id: this.nextId(),
      event: 'trace_summary',
      timestamp: new Date().toISOString(),
      app_files: Array.from(this.appFilesTouched).sort(),
      external_files: Array.from(this.externalFilesTouched).sort(),
      methods_called: Array.from(this.methodsSeen).sort(),
      total_steps: this.traceId - 1,
      async_resource_count: this.asyncResources.size,
      errors: this.errors
    })
  }

  writeEntry(entry) {
    if (entry.file_path && !this.isApplicationCode(entry.file_path)) {
      this.externalFilesTouched.add(entry.file_path)
    }

    fs.writeSync(this.fileDescriptor, `${JSON.stringify(entry)}\n`)
  }

  nextId() {
    this.traceId += 1
    return this.traceId
  }

  post(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (error, result) => {
        if (error) {
          reject(error)
          return
        }

        resolve(result)
      })
    })
  }

  async safePost(method, params = {}) {
    try {
      return await this.post(method, params)
    } catch (_error) {
      return null
    }
  }
}

function normalizeScriptPath(url) {
  if (!url || typeof url !== 'string') {
    return null
  }

  if (url.startsWith('file://')) {
    return fileURLToPath(url)
  }

  if (url.startsWith('node:') || url.startsWith('internal')) {
    return null
  }

  return path.isAbsolute(url) ? url : null
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function traceNodeFile(entryFile, outputFile, options = {}) {
  const tracer = new NodeExecutionTracer(outputFile, options)
  return tracer.trace(entryFile)
}

module.exports = {
  NodeExecutionTracer,
  traceNodeFile
}
