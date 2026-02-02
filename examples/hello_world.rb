# examples/hello_world.rb
# A simple example to test the tracer

class Greeter
  def initialize(name)
    @name = name
    @greet_count = 0
  end

  def greet
    @greet_count += 1
    message = "Hello, #{@name}!"
    puts message
    message
  end

  def greet_count
    @greet_count
  end
end

def main
  greeter = Greeter.new("World")
  greeter.greet
  greeter.greet
  puts "Greeted #{greeter.greet_count} times"
end

main
