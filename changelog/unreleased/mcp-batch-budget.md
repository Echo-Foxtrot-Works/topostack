---
type: fix
title: MCP batches are capped and each tool call counts against the agent budget
---
A JSON-RPC batch sent to the MCP server now holds at most 8 messages. Every tool call in a batch after the first now counts against the same budget as a separate request. A call over budget comes back as a tool error that the model can read.
