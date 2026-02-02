Gem::Specification.new do |s|
  s.name        = 'tracegraph'
  s.version     = '0.1.0'
  s.summary     = 'Ruby execution tracer'
  s.description = 'Traces Ruby program execution, capturing method calls, variables, and state changes'
  s.authors     = ['David Trejo']
  s.files       = Dir['lib/**/*.rb', 'bin/*']
  s.executables = ['trace']
  s.license     = 'MIT'

  s.add_development_dependency 'minitest'
end
