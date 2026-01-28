---
name: maxmsp
description: Critical MaxMSP MCP rules for object placement, gotchas, and tool usage. Invoke before creating/modifying Max patches.
user-invocable: true
disable-model-invocation: false
---

# MANDATORY CHECKLIST - Follow Before EVERY Action

## BEFORE placing ANY object:
```
0. Consider whether the task at hand is best served by using a subpatcher.
1. Call get_avoid_rect_position() FIRST
2. Use returned [left, top, right, bottom] to calculate position
3. Place at y = bottom + 50 (minimum)
```
**NEVER skip this step. NEVER guess positions.**

## Object tips:
- Use `groove~` not `play~` for seekable playback (play~ can't seek)
- Use `inlet`/`outlet` (no tilde versions exist)
- Invalid objects return errors automatically - check the error message for guidance

---

# Signal Flow Rules

**Auto-summing**: MSP inlets automatically sum all incoming signals. Never use `+~` just to combine signals - connect them both to the same inlet instead.

**Delay feedback**: Connect feedback directly to `tapin~`, never through a mixer first.

---

# Placement Rules

After calling `get_avoid_rect_position()` → `[left, top, right, bottom]`:
- First object: `[left, bottom + 50]`
- Same row: x += previous_width + 25
- New row: x = left, y += 50

---

# Subpatchers

**Use subpatchers** for: effects, voices, drums, sequencers, mixers, modulation.

```
create_subpatcher([x, y], "varname", "display_name")
enter_subpatcher("varname")
  add inlet/outlet objects
  build internal logic
exit_subpatcher()
connect from parent
```

---

# MCP Tools

| Tool | Purpose |
|------|---------|
| `get_avoid_rect_position()` | **REQUIRED** before placing |
| `add_max_object(pos, type, var, args)` | Create object |
| `move_object(var, x, y)` | Reposition |
| `recreate_with_args(var, args)` | Change creation-time args |
| `get_object_connections(var)` | Get all connections |
| `create_subpatcher(pos, var, name)` | Create p object |
| `enter_subpatcher(var)` / `exit_subpatcher()` | Navigate subpatchers |

---

# Message Boxes

- Use numbers: `[200, 0, 50]`
- NOT strings: `["200", "0", "50"]` (creates literal quotes)
- Fixed 70px width (user adjusts)
