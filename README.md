# MaxMSP-MCP Server (Extended Fork)

This project uses the [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) to let LLMs directly understand and generate Max patches.

> **Fork Notice**: This is an extended fork of the original [MaxMSP-MCP-Server](https://github.com/tiianhk/MaxMSP-MCP-Server) by Haokun Tian and Shuoyang Zheng. See [Acknowledgements](#acknowledgements) for details.

## What's New in This Fork

This fork significantly extends the original with new tools, safety features, and Claude Code integration:

### New MCP Tools (+11)

| Tool | Description |
|------|-------------|
| `create_subpatcher` | Create a new `p` (subpatcher) object |
| `enter_subpatcher` | Navigate into a subpatcher context |
| `exit_subpatcher` | Return to parent patcher |
| `get_patcher_context` | Get current depth and navigation path |
| `add_subpatcher_io` | Add inlet/outlet objects inside subpatchers |
| `get_object_connections` | Query all connections for an object |
| `recreate_with_args` | Change creation-time arguments, preserving connections |
| `move_object` | Reposition an object |
| `autofit_existing` | Apply auto-sizing to existing objects |
| `check_signal_safety` | Analyze patch for dangerous signal patterns |
| `encapsulate` | Encapsulate selected objects into a subpatcher |

### Safety & Validation Features

- **Float enforcement**: Math objects (`+`, `-`, `*`, `/`, `%`, `scale`, etc.) require float arguments at server level to prevent integer truncation bugs
- **Object validation**: Rejects invalid objects (e.g., `times~` → suggests `*~`)
- **Argument validation**: Enforces minimum arguments for complex objects (e.g., `comb~` requires 5 args)
- **Large patch warnings**: Alerts when root patcher exceeds 80 objects
- **Signal safety analysis**: Detects feedback loops, high gain, unsafe comb~ feedback, and missing limiters before `dac~`

### Quality of Life Improvements

- **Auto-sizing**: Objects and comments automatically fit their content
- **Increased timeouts**: Better handling of large patchers (5s vs 2s)
- **Subpatcher support**: Full navigation and creation within nested patchers
- **Alias preservation**: Encapsulate preserves user-facing names (`*~` not `times~`, `t` not `trigger`)

---

## Demo Videos

### Understand: LLM Explaining a Max Patch

![img](./assets/understand.gif)

[Video link](https://www.youtube.com/watch?v=YKXqS66zrec). Acknowledgement: the patch being explained is from [MaxMSP_TeachingSketches](https://github.com/jeffThompson/MaxMSP_TeachingSketches/blob/master/02_MSP/07%20Ring%20Modulation.maxpat).

### Generate: LLM Making an FM Synth

![img](./assets/generate.gif)

[Full video](https://www.youtube.com/watch?v=Ns89YuE5-to) with audio.

---

## Installation

### Prerequisites

- Python 3.8 or newer
- [uv package manager](https://github.com/astral-sh/uv)
- Max 9 or newer (requires JavaScript V8 engine)

### Installing the MCP Server

1. **Install uv:**
```bash
# macOS/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows:
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

2. **Clone and set up:**
```bash
git clone https://github.com/tiianhk/MaxMSP-MCP-Server.git
cd MaxMSP-MCP-Server
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

3. **Connect to your MCP client:**

**For Claude Code (recommended):**

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "maxmsp": {
      "command": "uv",
      "args": [
        "--directory",
        "/path/to/MaxMSP-MCP-Server",
        "run",
        "server.py"
      ]
    }
  }
}
```

**For Claude Desktop or Cursor:**

```
python install.py --client claude
# or
python install.py --client cursor
```

### Installing to a Max Patch

1. Open `MaxMSP_Agent/demo.maxpat` in Max 9
2. Click `script npm version` to verify npm is installed
3. Click `script npm install` to install dependencies
4. Click `script start` to begin communication

Once connected, the LLM can explain, modify, or create Max objects within the patch.

---

## Architecture

```
┌─────────────────┐     Socket.IO      ┌─────────────────┐
│   Claude Code   │ ←───────────────→  │    server.py    │
│  (MCP Client)   │     (port 5002)    │  (FastMCP/Python)│
└─────────────────┘                    └────────┬────────┘
                                                │
                                       ┌────────▼────────┐
                                       │ max_mcp_node.js │
                                       │   (Node.js)     │
                                       └────────┬────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │                                   │
                     ┌────────▼────────┐              ┌───────────▼───────────┐
                     │   max_mcp.js    │              │ max_mcp_v8_add_on.js  │
                     │  (Max js object)│              │   (Max v8 runtime)    │
                     └─────────────────┘              └───────────────────────┘
```

- **server.py** - Python FastMCP server with Socket.IO, validation, and tool definitions
- **max_mcp_node.js** - Node.js bridge running inside Max's `node.script`
- **max_mcp.js** - Main Max-side JavaScript handler for most operations
- **max_mcp_v8_add_on.js** - V8 JavaScript with `boxtext` access for encapsulation

---

## MCP Tools Reference

### Object Creation & Manipulation

| Tool | Description |
|------|-------------|
| `add_max_object(position, obj_type, varname, args)` | Create an object |
| `remove_max_object(varname)` | Delete an object |
| `connect_max_objects(src, outlet, dst, inlet)` | Connect two objects |
| `disconnect_max_objects(src, outlet, dst, inlet)` | Disconnect objects |
| `move_object(varname, x, y)` | Reposition an object |
| `recreate_with_args(varname, new_args)` | Change creation-time args |
| `autofit_existing(varname)` | Auto-size existing object |

### Object Properties

| Tool | Description |
|------|-------------|
| `set_object_attribute(varname, attr, value)` | Set an attribute |
| `set_message_text(varname, text_list)` | Set message box content |
| `set_number(varname, num)` | Set number box/slider value |
| `send_bang_to_object(varname)` | Send a bang |
| `send_messages_to_object(varname, message)` | Send message list |

### Query Tools

| Tool | Description |
|------|-------------|
| `get_objects_in_patch()` | Get all objects and connections |
| `get_objects_in_selected()` | Get selected objects |
| `get_object_attributes(varname)` | Get object's attributes |
| `get_object_connections(varname)` | Get object's connections |
| `get_avoid_rect_position()` | Get bounding box for placement |
| `list_all_objects()` | List available Max objects |
| `get_object_doc(name)` | Get Max documentation |

### Subpatcher Navigation

| Tool | Description |
|------|-------------|
| `create_subpatcher(position, varname, name)` | Create a `p` object |
| `enter_subpatcher(varname)` | Navigate into subpatcher |
| `exit_subpatcher()` | Return to parent |
| `get_patcher_context()` | Get current depth/path |
| `add_subpatcher_io(position, io_type, varname)` | Add inlet/outlet |

### Safety & Organization

| Tool | Description |
|------|-------------|
| `check_signal_safety()` | Analyze for dangerous patterns |
| `encapsulate(varnames, name, varname)` | Encapsulate objects |

---


## Development

After making code changes:

1. Reload js objects in Max (double-click to open editor, then close)
2. Restart node.script (`script stop`, then `script start`)

---

## Acknowledgements

This fork is based on the original [MaxMSP-MCP-Server](https://github.com/tiianhk/MaxMSP-MCP-Server) created by **Haokun Tian** and **Shuoyang Zheng**.

The original project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

**Original repository:** https://github.com/tiianhk/MaxMSP-MCP-Server

---

## Disclaimer

This is a third-party implementation and not made by Cycling '74.
