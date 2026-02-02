Perfect! Let me add constant tracking. Constants in Ruby include both regular constants (like `PI = 3.14`) and class/module names themselves. Here's the updated tracer:

```ruby
# tracer.rb
require 'json'
require 'set'

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
      next unless tp.path.end_with?('.rb')
      
      # Determine if this is app code
      is_app_code = is_application_code?(tp.path)
      
      # For non-app code, only trace call and return events (not individual lines)
      if !is_app_code
        next unless tp.event == :call || tp.event == :return || 
                    tp.event == :c_call || tp.event == :c_return
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
          trace_entry[:locals] = locals unless locals.empty?
        rescue => e
          trace_entry[:locals_error] = e.message
        end
        
        # Capture instance variables if we're in an instance method
        if tp.binding.receiver && !tp.binding.receiver.is_a?(Class)
          ivars = capture_instance_variables(tp.binding.receiver)
          trace_entry[:instance_variables] = ivars unless ivars.empty?
        end
        
        # Capture class variables if we're in a class method or class body
        if tp.defined_class && tp.defined_class.is_a?(Class)
          cvars = capture_class_variables(tp.defined_class)
          trace_entry[:class_variables] = cvars unless cvars.empty?
        end
        
        # Capture constants accessible from current scope
        constants = capture_constants(tp.binding)
        trace_entry[:constants] = constants unless constants.empty?
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
          trace_entry[:params] = params unless params.empty?
          
          # Capture parameter values
          param_values = {}
          tp.binding.local_variables.each do |var|
            param_values[var.to_s] = serialize_value(tp.binding.local_variable_get(var))
          end
          trace_entry[:param_values] = param_values unless param_values.empty?
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
    
    # Check if path is in gem or Ruby stdlib
    return false if path.include?('/gems/')
    return false if path.include?('/lib/ruby/')
    return false if path.start_with?(RbConfig::CONFIG['rubylibdir'])
    
    # Check if path is within our application paths
    @app_paths.any? { |app_path| path.start_with?(File.expand_path(app_path)) }
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

  def capture_constants(binding)
    constants = {}
    
    begin
      # Get the module/class we're currently in
      current_module = binding.receiver.class
      
      # If we're in a class definition context, use that class
      if binding.receiver.is_a?(Module)
        current_module = binding.receiver
      end
      
      # Get constants defined in the current scope
      # We'll collect constants from the current module and its ancestors
      modules_to_check = [current_module]
      
      # Add included/prepended modules
      if current_module.is_a?(Class)
        modules_to_check += current_module.ancestors.take_while { |m| m != Object }
      end
      
      seen_constants = Set.new
      
      modules_to_check.each do |mod|
        next unless mod.is_a?(Module)
        
        # Only check constants directly defined in this module (not inherited)
        begin
          mod_constants = mod.constants(false)
        rescue
          next
        end
        
        mod_constants.each do |const_name|
          # Skip if we've already seen this constant
          full_const_name = "#{mod.name}::#{const_name}"
          next if seen_constants.include?(full_const_name)
          seen_constants.add(full_const_name)
          
          begin
            value = mod.const_get(const_name)
            
            # Skip Module/Class constants unless they're specifically interesting
            # (We'll include them but mark them as such)
            is_module = value.is_a?(Module)
            
            serialized = serialize_value(value)
            serialized[:module_or_class] = true if is_module
            
            # Track changes to constants
            const_key = full_const_name
            
            if @constant_states[const_key]
              prev_state = @constant_states[const_key]
              # Constants shouldn't change, but if they do (via const_set), we track it
              if prev_state[:value_hash] != value.hash
                serialized[:changed] = true
                serialized[:previous_value_id] = prev_state[:trace_id]
                serialized[:warning] = "Constant was redefined!"
              end
            else
              serialized[:created] = true
            end
            
            # Update state tracking
            @constant_states[const_key] = {
              value_hash: value.hash,
              trace_id: @trace_id
            }
            
            constants[full_const_name] = serialized
            
          rescue NameError, StandardError => e
            # Some constants might not be accessible
            next
          end
        end
      end
      
      # Also check for constants in the top-level namespace if we're in Object
      if current_module == Object || binding.receiver == main
        Object.constants(false).each do |const_name|
          full_const_name = "::#{const_name}"
          next if seen_constants.include?(full_const_name)
          
          begin
            value = Object.const_get(const_name)
            next if value.is_a?(Module) && value.name.nil? # Skip anonymous modules
            
            is_module = value.is_a?(Module)
            serialized = serialize_value(value)
            serialized[:module_or_class] = true if is_module
            
            const_key = full_const_name
            
            if @constant_states[const_key]
              prev_state = @constant_states[const_key]
              if prev_state[:value_hash] != value.hash
                serialized[:changed] = true
                serialized[:previous_value_id] = prev_state[:trace_id]
                serialized[:warning] = "Constant was redefined!"
              end
            else
              serialized[:created] = true
            end
            
            @constant_states[const_key] = {
              value_hash: value.hash,
              trace_id: @trace_id
            }
            
            constants[full_const_name] = serialized
          rescue NameError, StandardError
            next
          end
        end
      end
      
    rescue => e
      return { error: "Could not capture constants: #{e.message}" }
    end
    
    # Only return non-Module/Class constants by default to reduce noise
    # (unless they were just created in app code)
    constants.select do |name, info|
      !info[:module_or_class] || info[:created]
    end
  end

  def extract_method_definition(tp)
    begin
      # Get the method object
      method_obj = tp.defined_class.instance_method(tp.method_id)
      source_location = method_obj.source_location
      
      return nil unless source_location
      
      file_path, start_line = source_location
      
      # Only extract for app code
      return nil unless is_application_code?(file_path)
      
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
    
    unless @file_cache.key?(file_path)
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
```

Now let's create an example that demonstrates constant tracking:

```ruby
# example_constants.rb

# Module-level constants
module MathConstants
  PI = 3.14159
  E = 2.71828
  GOLDEN_RATIO = 1.618
end

# Class with constants
class Configuration
  VERSION = "1.0.0"
  MAX_RETRIES = 3
  TIMEOUT_SECONDS = 30
  
  ENVIRONMENTS = {
    development: "dev.example.com",
    production: "example.com"
  }
  
  def initialize(env)
    @environment = env
    @version = VERSION
  end
  
  def get_url
    ENVIRONMENTS[@environment] || ENVIRONMENTS[:development]
  end
  
  def max_attempts
    MAX_RETRIES
  end
end

# Top-level constants
API_KEY = "secret_key_12345"
DEBUG_MODE = true

def calculate_circle_area(radius)
  # Using module constant
  area = MathConstants::PI * radius * radius
  puts "Area: #{area}"
  area
end

def process_with_config
  config = Configuration.new(:production)
  puts "Version: #{config.instance_variable_get(:@version)}"
  puts "URL: #{config.get_url}"
  puts "Max retries: #{config.max_attempts}"
  
  if DEBUG_MODE
    puts "Debug: API Key is #{API_KEY}"
  end
end

# Main execution
calculate_circle_area(5.0)
process_with_config

# Demonstrate constant reassignment (which Ruby warns about but allows)
puts "Changing PI (bad practice!)"
MathConstants.send(:remove_const, :PI)
MathConstants.const_set(:PI, 3.14)
calculate_circle_area(5.0)
```

Example trace output showing constant tracking:

```jsonl
{"id":1,"timestamp":"2026-01-01T10:30:45.123Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":4,"event":"line","method":"<main>","class":null,"app_code":true,"source":"module MathConstants","locals":{},"constants":{"::API_KEY":{"value":"\"secret_key_12345\"","type":"String","object_id":12345,"created":true},"::DEBUG_MODE":{"value":"true","type":"TrueClass","object_id":20,"created":true}}}

{"id":5,"timestamp":"2026-01-01T10:30:45.127Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":5,"event":"line","method":"<module:MathConstants>","class":"MathConstants","app_code":true,"source":"  PI = 3.14159","locals":{},"constants":{}}

{"id":6,"timestamp":"2026-01-01T10:30:45.128Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":6,"event":"line","method":"<module:MathConstants>","class":"MathConstants","app_code":true,"source":"  E = 2.71828","locals":{},"constants":{"MathConstants::PI":{"value":"3.14159","type":"Float","object_id":45678,"created":true}}}

{"id":7,"timestamp":"2026-01-01T10:30:45.129Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":7,"event":"line","method":"<module:MathConstants>","class":"MathConstants","app_code":true,"source":"  GOLDEN_RATIO = 1.618","locals":{},"constants":{"MathConstants::PI":{"value":"3.14159","type":"Float","object_id":45678},"MathConstants::E":{"value":"2.71828","type":"Float","object_id":45679,"created":true}}}

{"id":15,"timestamp":"2026-01-01T10:30:45.137Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":30,"event":"call","method":"calculate_circle_area","class":"Object","app_code":true,"method_definition":{"source":"def calculate_circle_area(radius)\n  # Using module constant\n  area = MathConstants::PI * radius * radius\n  puts \"Area: #{area}\"\n  area\nend","file":"/path/to/example_constants.rb","start_line":30,"end_line":35,"signature":"Object#calculate_circle_area"},"params":["radius"],"param_values":{"radius":{"value":"5.0","type":"Float","object_id":67890}},"constants":{"MathConstants::PI":{"value":"3.14159","type":"Float","object_id":45678},"MathConstants::E":{"value":"2.71828","type":"Float","object_id":45679},"MathConstants::GOLDEN_RATIO":{"value":"1.618","type":"Float","object_id":45680},"Configuration::VERSION":{"value":"\"1.0.0\"","type":"String","object_id":55555,"created":true},"Configuration::MAX_RETRIES":{"value":"3","type":"Integer","object_id":7,"created":true},"Configuration::TIMEOUT_SECONDS":{"value":"30","type":"Integer","object_id":61,"created":true},"Configuration::ENVIRONMENTS":{"value":"{:development=>\"dev.example.com\", :production=>\"example.com\"}","type":"Hash","object_id":66666,"created":true},"::API_KEY":{"value":"\"secret_key_12345\"","type":"String","object_id":12345},"::DEBUG_MODE":{"value":"true","type":"TrueClass","object_id":20}}}

{"id":16,"timestamp":"2026-01-01T10:30:45.138Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":32,"event":"line","method":"calculate_circle_area","class":"Object","app_code":true,"source":"  area = MathConstants::PI * radius * radius","locals":{"radius":{"value":"5.0","type":"Float","object_id":67890}},"constants":{"MathConstants::PI":{"value":"3.14159","type":"Float","object_id":45678},"MathConstants::E":{"value":"2.71828","type":"Float","object_id":45679},"MathConstants::GOLDEN_RATIO":{"value":"1.618","type":"Float","object_id":45680}}}

// ... later when PI is reassigned ...

{"id":75,"timestamp":"2026-01-01T10:30:45.195Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":60,"event":"line","method":"<main>","class":null,"app_code":true,"source":"MathConstants.const_set(:PI, 3.14)","locals":{},"constants":{"MathConstants::PI":{"value":"3.14159","type":"Float","object_id":45678}}}

{"id":76,"timestamp":"2026-01-01T10:30:45.196Z","file":"example_constants.rb","file_path":"/path/to/example_constants.rb","line":61,"event":"line","method":"<main>","class":null,"app_code":true,"source":"calculate_circle_area(5.0)","locals":{},"constants":{"MathConstants::PI":{"value":"3.14","type":"Float","object_id":99999,"changed":true,"previous_value_id":75,"warning":"Constant was redefined!"}}}

{"id":100,"event":"trace_summary","timestamp":"2026-01-01T10:30:45.200Z","app_files":["/path/to/example_constants.rb"],"external_files":[],"methods_called":["Configuration#get_url","Configuration#initialize","Configuration#max_attempts","Object#calculate_circle_area","Object#process_with_config"],"total_steps":99,"method_definitions":{"Configuration#initialize":10,"Configuration#get_url":20,"Configuration#max_attempts":25,"Object#calculate_circle_area":15,"Object#process_with_config":40},"object_count":8,"constants_tracked":["::API_KEY","::DEBUG_MODE","Configuration::ENVIRONMENTS","Configuration::MAX_RETRIES","Configuration::TIMEOUT_SECONDS","Configuration::VERSION","MathConstants::E","MathConstants::GOLDEN_RATIO","MathConstants::PI"],"configuration":{"app_paths":["/path/to"],"trace_gems":false,"trace_stdlib":false}}
```

Key features for constant tracking:

1. **Constants captured at each scope** - Shows all constants accessible from current context
2. **Creation tracking** - First time a constant appears gets `created: true`
3. **Change detection** - If a constant is reassigned (bad practice!), it's flagged with `changed: true`, `previous_value_id`, and a warning
4. **Module/Class distinction** - Module and Class constants are marked with `module_or_class: true`
5. **Full qualified names** - Constants shown as `Module::CONST` or `::CONST` for top-level
6. **Summary includes all constants** - The trace summary lists all constants that were tracked

Constants are now tracked just like any other variable! This is especially useful for:
- Configuration values
- API keys and secrets (helps identify where they're used)
- Mathematical/scientific constants
- Enums and lookup tables
- Detecting constant reassignment bugs

Ready to move forward with more features?