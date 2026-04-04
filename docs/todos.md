# Todos

## Completed
- [x] Create ExecutionTracer class with TracePoint API
- [x] Capture method calls, returns, and source lines
- [x] Track local and instance variables
- [x] Track class variables with change detection
- [x] Detect instance variable changes with `changed` flag
- [x] Add hello world example
- [x] Add CLI script (bin/trace)
- [x] Add minitest tests
- [x] Set up Gemfile and gemspec

## In Progress

## Todo
- [ ] Support recording separate trace file per test block
- [ ] Add happy-path assertion for each completed feature
- [ ] Add constant tracking with `capture_constants` method
- [ ] Detect constant redefinition with warning flag
- [ ] Implement `trace_gems` option
- [ ] Implement `trace_stdlib` option
- [ ] Add example_constants.rb demo from vision doc
- [ ] Add call stack depth to trace entries
- [x] Create trace viewer/formatter (pretty print JSONL)
- [ ] Add filtering options (exclude certain methods/classes)
- [ ] Support tracing Rails applications
- [ ] Add benchmarks for tracer overhead
- [ ] Research multi-language debugger integrations (VS Code/DAP, Delve, debugpy, Java JDWP) and define a unified cross-language trace adapter model
- [ ] Add Node tracer `balanced` mode (call/return + selective line stepping in app files only)
- [ ] Add Node tracer `fast` mode (function-level tracing + async causality, no per-line stepping)
- [ ] Add Node tracer sampling mode (interval-based stack capture for low overhead)
