# Writing Progress (Obsidian Plugin)
This is a simple plugin to help monitor and reward progress as you write

It does the following things
* Adds word counts to the chapters under your root path (similar to novel word count)
* Adds a progress meter to the explorer pane on the left with metrics for
    * Latest chapter length (words)
    * Pace of writing (words/week)
    * Number of chapters
    * Total Novel length (words)

It also notifies you when you break through a limit!

You can configure a set of breakpoints under **plugin settings**

Say you set a breakpoint of `100, 1k` for Words:
When you write your 101st word
- The progress meter for words fills to 100%
- You get a notification letting you know you did good!
- The progress meter switches over to the next breakpoint (configured )

