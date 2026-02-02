# tracer.rb
require 'json'
require 'set'
require 'time'

class ExecutionTracer
  def initialize(output_file, options = {})
    @output_file = output_file
    @trace_id = 0
    @file = File.open(output_file, 'w')
    @last_line = nil

    # Configuration
    @app_paths = options[:app_paths] || [Dir.pwd]
    @trace_gems = options[:trace_gems] || false
    @trace_stdlib = options[:trace_stdlib] || false

    # Track what we've seen for summary and deduplication
    @files_touched = Set.new
    @methods_seen = Set.new
    @method_definitions = {} # method_key => trace_id where definition was recorded

    # Track object states for change detection
    @object_states = {} # object_id => { ivar_name => { value_hash, trace_id } }
    @constant_states = {} # "Module::CONST" => { value_hash, trace_id }
  end

  def trace(&block)
    trace_point = TracePoint.new(:line, :call, :return, :c_call, :c_return) do |tp|
      # Skip tracing the tracer itself
      next if tp.path.include?('tracer.rb')
      next if tp.path.start_with?('<internal:')
      next if tp.path.nil? || !tp.path.end_with?('.rb')

      # Determine if this is app code
      is_app_code = is_application_code?(tp.path)

      # For non-app code, only trace call and return events (not individual lines)
      if !is_app_code
        next if tp.event != :call && tp.event != :return &&
                tp.event != :c_call && tp.event != :c_return
      end

      # Track files touched
      @files_touched.add(tp.path)

      # Skip duplicate line events for app code
      if is_app_code
        current_location = "#{tp.path}:#{tp.lineno}"
        if tp.event == :line && current_location == @last_line
          next
        end
        @last_line = current_location if tp.event == :line
      end

      @trace_id += 1

      trace_entry = {
        id: @trace_id,
        timestamp: Time.now.iso8601(3),
        file: File.basename(tp.path),
        file_path: tp.path,
        line: tp.lineno,
        event: tp.event.to_s,
        method: tp.method_id&.to_s || '<main>',
        class: tp.defined_class&.to_s,
        app_code: is_app_code
      }

      # For call events, capture method definition on first call (only for app code)
      if tp.event == :call
        method_key = "#{tp.defined_class}##{tp.method_id}"
        @methods_seen.add(method_key)

        # First time seeing this method AND it's app code? Include full definition
        if is_app_code && !@method_definitions.key?(method_key)
          method_def = extract_method_definition(tp)
          if method_def
            trace_entry[:method_definition] = method_def
            @method_definitions[method_key] = @trace_id
          end
        elsif @method_definitions.key?(method_key)
          # Reference back to where we first defined it
          trace_entry[:method_definition_id] = @method_definitions[method_key]
        end
      end

      # Capture local variables (only for app code line events)
      if is_app_code && (tp.event == :line || tp.event == :call)
        begin
          locals = {}
          tp.binding.local_variables.each do |var|
            value = tp.binding.local_variable_get(var)
            locals[var.to_s] = serialize_value(value)
          end
          trace_entry[:locals] = locals if locals.any?
        rescue => e
          trace_entry[:locals_error] = e.message
        end

        # Capture instance variables if we're in an instance method
        if tp.binding.receiver && !tp.binding.receiver.is_a?(Class)
          ivars = capture_instance_variables(tp.binding.receiver)
          trace_entry[:instance_variables] = ivars if ivars.any?
        end

        # Capture class variables if we're in a class method or class body
        if tp.defined_class && tp.defined_class.is_a?(Class)
          cvars = capture_class_variables(tp.defined_class)
          trace_entry[:class_variables] = cvars if cvars.any?
        end
      end

      # Capture return value for all methods (app code and external)
      if tp.event == :return || tp.event == :c_return
        begin
          trace_entry[:return_value] = serialize_value(tp.return_value)
        rescue => e
          trace_entry[:return_value] = "<error: #{e.message}>"
        end
      end

      # Capture method parameters for call events
      if tp.event == :call
        begin
          params = tp.binding.local_variables.map(&:to_s)
          trace_entry[:params] = params if params.any?

          # Capture parameter values
          param_values = {}
          tp.binding.local_variables.each do |var|
            param_values[var.to_s] = serialize_value(tp.binding.local_variable_get(var))
          end
          trace_entry[:param_values] = param_values if param_values.any?
        rescue
        end
      end

      # Capture source line for app code line events
      if is_app_code && tp.event == :line
        begin
          source_line = get_source_line(tp.path, tp.lineno)
          trace_entry[:source] = source_line if source_line
        rescue => e
          trace_entry[:source_error] = e.message
        end
      end

      @file.puts(trace_entry.to_json)
      @file.flush
    end

    trace_point.enable
    result = block.call
    trace_point.disable

    # Write summary at the end
    write_summary

    result
  ensure
    @file.close if @file && !@file.closed?
  end

  private

  def is_application_code?(path)
    return false if path.nil?

    # Expand to absolute path for comparison
    abs_path = File.expand_path(path)

    # Check if path is in gem or Ruby stdlib
    return false if abs_path.include?('/gems/')
    return false if abs_path.include?('/lib/ruby/')
    return false if abs_path.start_with?(RbConfig::CONFIG['rubylibdir'])

    # Check if path is within our application paths
    @app_paths.any? { |app_path| abs_path.start_with?(File.expand_path(app_path)) }
  end

  def capture_instance_variables(object)
    ivars = {}

    begin
      object.instance_variables.each do |ivar|
        value = object.instance_variable_get(ivar)
        serialized = serialize_value(value)

        # Track changes to instance variables
        obj_id = object.object_id
        ivar_name = ivar.to_s

        @object_states[obj_id] ||= {}

        # Check if this variable changed
        if @object_states[obj_id][ivar_name]
          prev_state = @object_states[obj_id][ivar_name]
          if prev_state[:value_hash] != value.hash
            serialized[:changed] = true
            serialized[:previous_value_id] = prev_state[:trace_id]
          end
        else
          serialized[:created] = true
        end

        # Update state tracking
        @object_states[obj_id][ivar_name] = {
          value_hash: value.hash,
          trace_id: @trace_id
        }

        ivars[ivar_name] = serialized
      end
    rescue => e
      return { error: "Could not capture instance variables: #{e.message}" }
    end

    ivars
  end

  def capture_class_variables(klass)
    cvars = {}

    begin
      klass.class_variables.each do |cvar|
        value = klass.class_variable_get(cvar)
        serialized = serialize_value(value)

        # Track changes to class variables
        class_key = "#{klass.name}::#{cvar}"

        @object_states[class_key] ||= {}

        if @object_states[class_key][:value]
          prev_state = @object_states[class_key][:value]
          if prev_state[:value_hash] != value.hash
            serialized[:changed] = true
            serialized[:previous_value_id] = prev_state[:trace_id]
          end
        else
          serialized[:created] = true
        end

        # Update state tracking
        @object_states[class_key][:value] = {
          value_hash: value.hash,
          trace_id: @trace_id
        }

        cvars[cvar.to_s] = serialized
      end
    rescue => e
      return { error: "Could not capture class variables: #{e.message}" }
    end

    cvars
  end

  def extract_method_definition(tp)
    begin
      # Get the method object
      method_obj = tp.defined_class.instance_method(tp.method_id)
      source_location = method_obj.source_location

      return nil if source_location.nil?

      file_path, start_line = source_location

      # Only extract for app code
      return nil if !is_application_code?(file_path)

      # Read the source file
      lines = File.readlines(file_path)

      # Extract method body
      method_lines = []
      indent_level = nil
      in_method = false

      (start_line - 1).upto(lines.length - 1) do |i|
        line = lines[i]

        if !in_method
          method_lines << line.rstrip
          in_method = true
          indent_level = line[/^\s*/].length
        else
          current_indent = line[/^\s*/].length

          if line.strip == 'end' && current_indent <= indent_level
            method_lines << line.rstrip
            break
          elsif line.strip.start_with?('end') && current_indent <= indent_level
            method_lines << line.rstrip
            break
          else
            method_lines << line.rstrip
          end
        end
      end

      {
        source: method_lines.join("\n"),
        file: file_path,
        start_line: start_line,
        end_line: start_line + method_lines.length - 1,
        signature: "#{tp.defined_class}##{tp.method_id}"
      }
    rescue => e
      {
        error: "Could not extract method definition: #{e.message}",
        signature: "#{tp.defined_class}##{tp.method_id}"
      }
    end
  end

  def get_source_line(file_path, line_number)
    @file_cache ||= {}

    if !@file_cache.key?(file_path)
      @file_cache[file_path] = File.readlines(file_path)
    end

    lines = @file_cache[file_path]
    return nil if line_number < 1 || line_number > lines.length

    lines[line_number - 1].rstrip
  end

  def write_summary
    @trace_id += 1

    # Separate app code from external code
    app_files = @files_touched.select { |f| is_application_code?(f) }
    external_files = @files_touched.reject { |f| is_application_code?(f) }

    summary = {
      id: @trace_id,
      event: "trace_summary",
      timestamp: Time.now.iso8601(3),
      app_files: app_files.sort,
      external_files: external_files.sort,
      methods_called: @methods_seen.to_a.sort,
      total_steps: @trace_id - 1,
      method_definitions: @method_definitions,
      object_count: @object_states.keys.count,
      constants_tracked: @constant_states.keys.sort,
      configuration: {
        app_paths: @app_paths,
        trace_gems: @trace_gems,
        trace_stdlib: @trace_stdlib
      }
    }

    @file.puts(summary.to_json)
    @file.flush
  end

  def serialize_value(value)
    {
      value: inspect_value(value),
      type: value.class.to_s,
      object_id: value.object_id
    }
  rescue => e
    {
      value: "<error serializing: #{e.message}>",
      type: "Unknown",
      object_id: nil
    }
  end

  def inspect_value(value)
    inspected = value.inspect
    if inspected.length > 200
      inspected[0..197] + "..."
    else
      inspected
    end
  end
end

# Convenience methods
def trace_file(ruby_file, trace_file = nil, options = {})
  trace_file ||= "#{ruby_file}.trace"

  # Default app_paths to the directory of the file being traced
  options[:app_paths] ||= [File.dirname(File.expand_path(ruby_file))]

  tracer = ExecutionTracer.new(trace_file, options)

  puts "Tracing #{ruby_file} -> #{trace_file}"
  puts "App paths: #{options[:app_paths].join(', ')}"

  tracer.trace do
    load ruby_file
  end

  puts "Trace complete: #{trace_file}"
end

def trace_execution(name, options = {}, &block)
  trace_file = "#{name}.trace"

  # Default app_paths to current directory
  options[:app_paths] ||= [Dir.pwd]

  tracer = ExecutionTracer.new(trace_file, options)

  puts "Tracing #{name} -> #{trace_file}"

  result = tracer.trace(&block)

  puts "Trace complete: #{trace_file}"
  result
end
