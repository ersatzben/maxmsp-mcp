# MaxMSP MCP Server

This project provides MCP tools for programmatic Max/MSP patch manipulation.

## Critical Rules

**Run `/maxmsp` skill before creating or modifying patches** - it contains all placement rules, object gotchas, and tool usage guidelines that MUST be followed.

### Quick Reminders (details in skill)

- **CONSIDER SUBPATCHERS** for new functionality! 
- **NO OVERLAP**: Always call `get_avoid_rect_position()` before placing objects
- **Use `groove~` not `play~`** for seekable playback
- **Message boxes**: Use numbers `[200, 0, 50]` not strings `["200", "0", "50"]`
- **Auto-sizing**: Objects & comments auto-size; messages fixed 70px; UI objects keep defaults

## MCP Tools

Key tools for object manipulation:
- `get_avoid_rect_position()` - Get bounding box before placing
- `add_max_object()` - Create object (auto-fits width)
- `recreate_with_args()` - Change creation-time args, preserving connections
- `move_object()` - Reposition object
- `autofit_existing()` - Apply auto-fit to existing object

## Architecture

- `server.py` - Python FastMCP server with Socket.IO
- `MaxMSP_Agent/max_mcp.js` - Main Max-side JavaScript handler
- `MaxMSP_Agent/max_mcp_v8_add_on.js` - V8 JavaScript with `obj.boxtext` access

**After code changes**: Reload js objects in Max (double-click to open editor, then close) and restart node.script (`script stop`, `script start`).
