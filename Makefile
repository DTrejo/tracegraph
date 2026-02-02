.PHONY: test trace view

test:
	ruby test/tracer_test.rb

trace:
	ruby bin/trace examples/hello_world.rb

view:
	ruby bin/trace-view examples/hello_world.rb.trace
