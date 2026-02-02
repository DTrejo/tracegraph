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
- [ ] Add constant tracking with `capture_constants` method
- [ ] Detect constant redefinition with warning flag
- [ ] Implement `trace_gems` option
- [ ] Implement `trace_stdlib` option
- [ ] Add example_constants.rb demo from vision doc
- [ ] Add call stack depth to trace entries
- [ ] Create trace viewer/formatter (pretty print JSONL)
- [ ] Add filtering options (exclude certain methods/classes)
- [ ] Support tracing Rails applications
- [ ] Add benchmarks for tracer overhead
