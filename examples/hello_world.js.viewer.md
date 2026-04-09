  1 call     hello_world.js:3 Greeter
    locals: name="World"
  2   line     hello_world.js:20 main
      > greeter.greet()
      locals: greeter=Greeter
  3   line     hello_world.js:8 greet
      > this.greetCount += 1
      locals: message=undefined
  4   line     hello_world.js:9 greet
      > const message = `Hello, ${this.name}!`
      locals: message=undefined
  5   line     hello_world.js:10 greet
      > console.log(message)
      locals: message="Hello, World!"
  6   line     hello_world.js:11 greet
      > return message
      locals: message="Hello, World!"
  7   line     hello_world.js:11 greet
      > return message
      locals: message="Hello, World!"
  8   line     hello_world.js:21 main
      > console.log(`Greeted ${greeter.greetCount} times`)
      locals: greeter=Greeter
  9   line     hello_world.js:22 main
      > }
      locals: greeter=Greeter
