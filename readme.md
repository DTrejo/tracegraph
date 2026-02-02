# tracegraph
Let's build a program execution recording tool, built on Ruby's tracepoint, which gives us the abilities of a time-traveling debugger while operating on a trace file.

Think VCR recordings but for program execution. VCR recordings allow us to record requests and responses to external APIs, and then replay and write tests on data without needing the internet. Tracegraph will allow us to replay execution while also seeing data and code.

## Why will this be useful?
[Code reviews are sad](https://dtrejo.com/code-reviews-sad). Both humans and AI need to do a WAY better job of giving code reviews. The key to that is to fuse code, execution, and data into one unified timeline. This greatly reduces cognitive overhead.

## Top use-cases
- Human code reviewers previewing program execution without needing to simulate it in their heads (think one trace per test entrypoint)
- AI reading traces and noticing bugs
- AI reading traces from vibe coded spaghetti messes, then writing simplified versions of that have the same features without the complexity.

## Related Tools
- https://play.kolo.app/
