.PHONY: test trace

test:
	ruby test/tracer_test.rb

trace:
	ruby bin/trace examples/hello_world.rb
