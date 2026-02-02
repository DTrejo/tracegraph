  1 c_call   hello_world.rb:0 set_encoding
  2 c_return hello_world.rb:0 set_encoding
    => #<File:examples/hello_world.rb>
  3 c_call   hello_world.rb:0 set_encoding
  4 c_return hello_world.rb:0 set_encoding
    => #<File:examples/hello_world.rb>
  5 line     hello_world.rb:4 
    > class Greeter
  6 c_call   hello_world.rb:4 const_added
  7 c_return hello_world.rb:4 const_added
    => nil
  8 c_call   hello_world.rb:4 inherited
  9 c_return hello_world.rb:4 inherited
    => nil
 10 line     hello_world.rb:5 
    > def initialize(name)
 11 c_call   hello_world.rb:5 method_added
 12 c_return hello_world.rb:5 method_added
    => nil
 13 line     hello_world.rb:10 
    > def greet
 14 c_call   hello_world.rb:10 method_added
 15 c_return hello_world.rb:10 method_added
    => nil
 16 line     hello_world.rb:17 
    > def greet_count
 17 c_call   hello_world.rb:17 method_added
 18 c_return hello_world.rb:17 method_added
    => nil
 19 line     hello_world.rb:22 
    > def main
 20 c_call   hello_world.rb:22 method_added
 21 c_return hello_world.rb:22 method_added
    => nil
 22 line     hello_world.rb:29 
    > main
 23 call     hello_world.rb:22 main
    locals: greeter=nil
 24   line     hello_world.rb:23 main
      > greeter = Greeter.new("World")
      locals: greeter=nil
 25   c_call   hello_world.rb:23 new
 26     call     hello_world.rb:5 initialize
        locals: name="World"
 27       line     hello_world.rb:6 initialize
          > @name = name
          locals: name="World"
 28       line     hello_world.rb:7 initialize
          > @greet_count = 0
          locals: name="World"
          ivars: @name="World" (new)
 29     return   hello_world.rb:8 initialize
        => 0
 30   c_return hello_world.rb:23 new
      => #<Greeter:0x000000010cac3e30 @name="World", @greet_count=0>
 31   line     hello_world.rb:24 main
      > greeter.greet
      locals: greeter=#<Greeter:0x000000010cac3e30 @name="World", @greet_count=0>
 32   call     hello_world.rb:10 greet
      locals: message=nil
      ivars: @greet_count=0 (new)
 33     line     hello_world.rb:11 greet
        > @greet_count += 1
        locals: message=nil
 34     c_call   hello_world.rb:11 +
 35     c_return hello_world.rb:11 +
        => 1
 36     line     hello_world.rb:12 greet
        > message = "Hello, #{@name}!"
        locals: message=nil
        ivars: @greet_count=1 (changed)
 37     line     hello_world.rb:13 greet
        > puts message
        locals: message="Hello, World!"
 38     c_call   hello_world.rb:13 puts
 39       c_call   hello_world.rb:13 puts
 40         c_call   hello_world.rb:13 write
 41         c_return hello_world.rb:13 write
            => 14
 42       c_return hello_world.rb:13 puts
          => nil
 43     c_return hello_world.rb:13 puts
        => nil
 44     line     hello_world.rb:14 greet
        > message
        locals: message="Hello, World!"
 45   return   hello_world.rb:15 greet
      => "Hello, World!"
 46   line     hello_world.rb:25 main
      > greeter.greet
      locals: greeter=#<Greeter:0x000000010cac3e30 @name="World", @greet_count=1>
 47   call     hello_world.rb:10 greet
      locals: message=nil
 48     line     hello_world.rb:11 greet
        > @greet_count += 1
        locals: message=nil
 49     c_call   hello_world.rb:11 +
 50     c_return hello_world.rb:11 +
        => 2
 51     line     hello_world.rb:12 greet
        > message = "Hello, #{@name}!"
        locals: message=nil
        ivars: @greet_count=2 (changed)
 52     line     hello_world.rb:13 greet
        > puts message
        locals: message="Hello, World!"
 53     c_call   hello_world.rb:13 puts
 54       c_call   hello_world.rb:13 puts
 55         c_call   hello_world.rb:13 write
 56         c_return hello_world.rb:13 write
            => 14
 57       c_return hello_world.rb:13 puts
          => nil
 58     c_return hello_world.rb:13 puts
        => nil
 59     line     hello_world.rb:14 greet
        > message
        locals: message="Hello, World!"
 60   return   hello_world.rb:15 greet
      => "Hello, World!"
 61   line     hello_world.rb:26 main
      > puts "Greeted #{greeter.greet_count} times"
      locals: greeter=#<Greeter:0x000000010cac3e30 @name="World", @greet_count=2>
 62   call     hello_world.rb:17 greet_count
 63     line     hello_world.rb:18 greet_count
        > @greet_count
 64   return   hello_world.rb:19 greet_count
      => 2
 65   c_call   hello_world.rb:26 puts
 66     c_call   hello_world.rb:26 puts
 67       c_call   hello_world.rb:26 write
 68       c_return hello_world.rb:26 write
          => 16
 69     c_return hello_world.rb:26 puts
        => nil
 70   c_return hello_world.rb:26 puts
      => nil
 71 return   hello_world.rb:27 main
    => nil
