require 'minitest/autorun'
require 'json'
require_relative '../lib/tracer'

class TracerTest < Minitest::Test
  def setup
    @trace_file = "test/tmp_test.trace"
  end

  def teardown
    File.delete(@trace_file) if File.exist?(@trace_file)
  end

  def test_returns_block_result
    tracer = ExecutionTracer.new(@trace_file, app_paths: [Dir.pwd])

    result = tracer.trace { 2 + 2 }

    assert_equal 4, result
  end

  def test_captures_c_calls
    tracer = ExecutionTracer.new(@trace_file, app_paths: [Dir.pwd])

    tracer.trace { "hello".upcase }

    lines = File.readlines(@trace_file).map { |l| JSON.parse(l) }
    events = lines.map { |l| l["event"] }

    assert_includes events, "c_call"
    assert_includes events, "c_return"
  end

  def test_writes_summary_at_end
    tracer = ExecutionTracer.new(@trace_file, app_paths: [Dir.pwd])

    tracer.trace { 1 + 1 }

    lines = File.readlines(@trace_file).map { |l| JSON.parse(l) }
    summary = lines.last

    assert_equal "trace_summary", summary["event"]
    assert summary.key?("total_steps")
    assert summary.key?("app_files")
  end
end
