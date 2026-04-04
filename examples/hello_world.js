class Greeter {
  constructor(name) {
    this.name = name
    this.greetCount = 0
  }

  greet() {
    this.greetCount += 1
    const message = `Hello, ${this.name}!`
    console.log(message)
    return message
  }
}

async function main() {
  const greeter = new Greeter('World')
  greeter.greet()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 1))
  greeter.greet()
  console.log(`Greeted ${greeter.greetCount} times`)
}

main()
