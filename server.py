# server.py
from mcp.server.fastmcp import FastMCP, Context
from contextlib import asynccontextmanager
import asyncio
import socketio

from typing import Callable, Any
import logging
import uuid
import os
import json

SOCKETIO_SERVER_URL = os.environ.get("SOCKETIO_SERVER_URL", "http://127.0.0.1")
SOCKETIO_SERVER_PORT = os.environ.get("SOCKETIO_SERVER_PORT", "5002")
NAMESPACE = os.environ.get("NAMESPACE", "/mcp")

current_dir = os.path.dirname(os.path.abspath(__file__))
docs_path = os.path.join(current_dir, "docs.json")
with open(docs_path, "r") as f:
    docs = json.load(f)
flattened_docs = {}
for obj_list in docs.values():
    for obj in obj_list:
        flattened_docs[obj["name"]] = obj

io_server_started = False


class MaxMSPConnection:
    def __init__(self, server_url: str, server_port: int, namespace: str = NAMESPACE):

        self.server_url = server_url
        self.server_port = server_port
        self.namespace = namespace

        self.sio = socketio.AsyncClient()
        self._pending = {}  # fetch requests that are not yet completed

        @self.sio.on("response", namespace=self.namespace)
        async def _on_response(data):
            req_id = data.get("request_id")
            fut = self._pending.get(req_id)
            if fut and not fut.done():
                fut.set_result(data.get("results"))

    async def send_command(self, cmd: dict):
        """Send a command to MaxMSP."""
        await self.sio.emit("command", cmd, namespace=self.namespace)
        logging.info(f"Sent to MaxMSP: {cmd}")

    async def send_request(self, payload: dict, timeout=2.0):
        """Send a fetch request to MaxMSP."""
        request_id = str(uuid.uuid4())
        future = asyncio.get_event_loop().create_future()
        self._pending[request_id] = future

        payload.update({"request_id": request_id})
        await self.sio.emit("request", payload, namespace=self.namespace)
        logging.info(f"Request to MaxMSP: {payload}")

        try:
            response = await asyncio.wait_for(future, timeout)
            return response
        except asyncio.TimeoutError:
            raise TimeoutError(f"No response received in {timeout} seconds.")
        finally:
            self._pending.pop(request_id, None)

    async def start_server(self) -> None:
        """IMPORTANT: This method should only be called ONCE per application instance.
        Multiple calls can lead to binding multiple ports unnecessarily.
        """
        try:
            # Connect to the server
            full_url = f"{self.server_url}:{self.server_port}"
            await self.sio.connect(full_url, namespaces=self.namespace)
            logging.info(f"Connected to Socket.IO server at {full_url}")
            return

        except OSError as e:
            logging.error(f"Error starting Socket.IO server: {e}")


@asynccontextmanager
async def server_lifespan(server: FastMCP):
    """Manage server lifespan"""
    global io_server_started
    if not io_server_started:
        try:
            maxmsp = MaxMSPConnection(
                SOCKETIO_SERVER_URL, SOCKETIO_SERVER_PORT, NAMESPACE
            )
            try:
                # Start the Socket.IO server
                await maxmsp.start_server()
                io_server_started = True
                logging.info(f"Listening on {maxmsp.server_url}:{maxmsp.server_port}")

                # Yield the Socket.IO connection to make it available in the lifespan context
                yield {"maxmsp": maxmsp}
            except Exception as e:
                logging.error(f"lifespan error starting server: {e}")
                await maxmsp.sio.disconnect()
                raise

        finally:
            logging.info("Shutting down connection")
            await maxmsp.sio.disconnect()
    else:
        logging.info(
            f"IO server already running on {maxmsp.server_url}:{maxmsp.server_port}"
        )


# Create the MCP server with lifespan support
mcp = FastMCP(
    "MaxMSPMCP",
    description="MaxMSP integration through the Model Context Protocol",
    lifespan=server_lifespan,
)

# Math objects that require float arguments (or explicit int_mode)
# These objects default to integer mode which truncates floats - a common source of bugs
FLOAT_REQUIRED_OBJECTS = {"+", "-", "*", "/", "!+", "!-", "!*", "!/", "%", "scale"}

# Pack objects - require float arguments (or explicit int_mode) like math objects
# This prevents the common bug of [pack 0 100] outputting ints when used with line~
PACK_OBJECTS = {"pack", "pak"}

# Objects that should be rejected with a suggestion for the correct alternative
REJECTED_OBJECTS = {
    "times~": "*~",
}

# Objects with minimum argument requirements
MIN_ARGS_OBJECTS = {
    "comb~": {
        "min_args": 5,
        "usage": "[comb~ maxdelay delay feedback feedforward gain] e.g. [comb~ 1000 100 0.9 0.5 1.]",
    },
}

# Parameter range validations (require extend=True to bypass)
PARAM_RANGE_CHECKS = {
    "svf~": {
        "arg_index": 1,  # Q is second argument (after frequency)
        "check": lambda v: v >= 1,
        "error": "svf~ Q/resonance should be 0-1, not 0-100. Got {value}. "
                 "Set extend=True if you really want Q >= 1.",
    },
    "onepole~": {
        "arg_index": 0,  # frequency is first argument
        "check": lambda v: v < 10,
        "error": "onepole~ takes frequency in Hz (e.g., 5000), not a coefficient. Got {value}. "
                 "Set extend=True if you really want frequency < 10 Hz.",
    },
}


def _has_float_arg(args: list) -> bool:
    """Check if any argument is a float (not an integer)."""
    for arg in args:
        if isinstance(arg, float):
            return True
    return False


def _pack_has_float_arg(args: list) -> bool:
    """Check if pack/pak has at least one float argument or 'f' type specifier."""
    for arg in args:
        if isinstance(arg, float):
            return True
        if isinstance(arg, str) and arg.lower() == "f":
            return True
    return False


@mcp.tool()
async def add_max_object(
    ctx: Context,
    position: list,
    obj_type: str,
    varname: str,
    args: list,
    int_mode: bool = False,
    extend: bool = False,
):
    """Add a new Max object.

    The position is is a list of two integers representing the x and y coordinates,
    which should be outside the rectangular area returned by get_avoid_rect_position() function.

    Args:
        position (list): Position in the Max patch as [x, y].
        obj_type (str): Type of the Max object (e.g., "cycle~", "dac~").
        varname (str): Variable name for the object.
        args (list): Arguments for the object.
        int_mode (bool): For math objects (+, -, *, /, %, scale, etc.) and pack/pak,
                         set True to allow integer-only arguments. By default, these objects
                         require at least one float argument (or 'f' type specifier for pack/pak)
                         to prevent unintended integer truncation.
        extend (bool): Bypass parameter range checks. Use when you intentionally want
                       unusual values like svf~ Q >= 1 or onepole~ frequency < 10 Hz.

    Returns:
        dict: Result with success/error status.
    """
    # Reject objects with known alternatives
    if obj_type in REJECTED_OBJECTS:
        correct = REJECTED_OBJECTS[obj_type]
        return {
            "success": False,
            "error": f"WRONG OBJECT: '{obj_type}' does not exist. Use '{correct}' instead.",
        }

    # Validate minimum argument requirements
    if obj_type in MIN_ARGS_OBJECTS:
        req = MIN_ARGS_OBJECTS[obj_type]
        if len(args) < req["min_args"]:
            return {
                "success": False,
                "error": f"MISSING ARGUMENTS: '{obj_type}' requires at least {req['min_args']} arguments. "
                         f"Usage: {req['usage']}",
            }

    # Validate float requirement for math objects
    if obj_type in FLOAT_REQUIRED_OBJECTS:
        if not _has_float_arg(args) and not int_mode:
            example = f"[{obj_type} 0.]" if not args else f"[{obj_type} {args[0]}.]"
            return {
                "success": False,
                "error": f"FLOAT REQUIRED: '{obj_type}' defaults to integer mode which truncates floats. "
                         f"Use a float argument (e.g., {example}) or set int_mode=True if integer truncation is intended.",
            }

    # Validate float requirement for pack/pak objects
    if obj_type in PACK_OBJECTS:
        if not _pack_has_float_arg(args) and not int_mode:
            example = f"[{obj_type} 0. 100]" if len(args) >= 2 else f"[{obj_type} f]"
            return {
                "success": False,
                "error": f"FLOAT REQUIRED: '{obj_type}' with integer arguments outputs integers. "
                         f"Use float arguments (e.g., {example}) or 'f' type specifier, "
                         f"or set int_mode=True if integer output is intended.",
            }

    # Validate parameter ranges (unless extend=True)
    if obj_type in PARAM_RANGE_CHECKS and not extend:
        check = PARAM_RANGE_CHECKS[obj_type]
        idx = check["arg_index"]
        if len(args) > idx:
            value = args[idx]
            if isinstance(value, (int, float)) and check["check"](value):
                return {
                    "success": False,
                    "error": f"PARAM RANGE: {check['error'].format(value=value)}",
                }

    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    assert len(position) == 2, "Position must be a list of two integers."
    payload = {
        "action": "add_object",
        "position": position,
        "obj_type": obj_type,
        "args": args,
        "varname": varname,
    }
    response = await maxmsp.send_request(payload, timeout=5.0)
    return response


@mcp.tool()
async def remove_max_object(
    ctx: Context,
    varname: str,
):
    """Delete a Max object.

    Args:
        varname (str): Variable name for the object.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "remove_object"}
    kwargs = {"varname": varname}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def connect_max_objects(
    ctx: Context,
    src_varname: str,
    outlet_idx: int,
    dst_varname: str,
    inlet_idx: int,
):
    """Connect two Max objects.

    Args:
        src_varname (str): Variable name of the source object.
        outlet_idx (int): Outlet index on the source object.
        dst_varname (str): Variable name of the destination object.
        inlet_idx (int): Inlet index on the destination object.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "connect_objects"}
    kwargs = {
        "src_varname": src_varname,
        "outlet_idx": outlet_idx,
        "dst_varname": dst_varname,
        "inlet_idx": inlet_idx,
    }
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def disconnect_max_objects(
    ctx: Context,
    src_varname: str,
    outlet_idx: int,
    dst_varname: str,
    inlet_idx: int,
):
    """Disconnect two Max objects.

    Args:
        src_varname (str): Variable name of the source object.
        outlet_idx (int): Outlet index on the source object.
        dst_varname (str): Variable name of the destination object.
        inlet_idx (int): Inlet index on the destination object.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "disconnect_objects"}
    kwargs = {
        "src_varname": src_varname,
        "outlet_idx": outlet_idx,
        "dst_varname": dst_varname,
        "inlet_idx": inlet_idx,
    }
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def set_object_attribute(
    ctx: Context,
    varname: str,
    attr_name: str,
    attr_value: list,
):
    """Set an attribute of a Max object.

    Args:
        varname (str): Variable name of the object.
        attr_name (str): Name of the attribute to be set.
        attr_value (list): Values of the attribute to be set.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "set_object_attribute"}
    kwargs = {"varname": varname, "attr_name": attr_name, "attr_value": attr_value}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def set_message_text(
    ctx: Context,
    varname: str,
    text_list: list,
):
    """Set the text of a message object in MaxMSP.

    Args:
        varname (str): Variable name of the message object.
        text_list (list): A list of arguments to be set to the message object.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "set_message_text"}
    kwargs = {"varname": varname, "new_text": text_list}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def send_bang_to_object(ctx: Context, varname: str):
    """Send a bang to an object in MaxMSP.

    Args:
        varname (str): Variable name of the object to be banged.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "send_bang_to_object"}
    kwargs = {"varname": varname}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def send_messages_to_object(
    ctx: Context,
    varname: str,
    message: list,
):
    """Send a message to an object in MaxMSP. The message is made of a list of arguments.

    When using message to set attributes, one attribute can only be set by one message.
    For example, to set the "size" attribute of a "button" object, use:
    send_messages_to_object("button1", ["size", 100, 100])
    To set the "size" and "color" attributes of a "button" object, use the tool for two times:
    send_messages_to_object("button1", ["size", 100, 100])
    send_messages_to_object("button1", ["color", 0, 0, 0])

    Args:
        varname (str): Variable name of the object to be messaged.
        message (list): A list of messages to be sent to the object.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "send_message_to_object"}
    kwargs = {"varname": varname, "message": message}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def set_number(
    ctx: Context,
    varname: str,
    num: float,
):
    """Set the value of a object in MaxMSP.
    The object can be a number box, a slider, a dial, a gain.

    Args:
        varname (str): Variable name of the comment object.
        num (float): Value to be set for the object.
    """

    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "set_number"}
    kwargs = {"varname": varname, "num": num}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
def list_all_objects(ctx: Context) -> list:
    """Returns a name list of all objects that can be added in Max.
    To understand a specific object in the list, use the `get_object_doc` tool."""
    return list(flattened_docs.keys())


@mcp.tool()
def get_object_doc(ctx: Context, object_name: str) -> dict:
    """Retrieve the official documentation for a given object.
    Use this resource to understand how a specific object works, including its
    description, inlets, outlets, arguments, methods(messages), and attributes.

    Args:
        object_name (str): Name of the object to look up.

    Returns:
        dict: Official documentations for the specified object.
    """
    try:
        return flattened_docs[object_name]
    except KeyError:
        return {
            "success": False,
            "error": "Invalid object name",
            "suggestion": "Make sure the object name is a valid Max object name.",
        }


@mcp.tool()
async def get_objects_in_patch(
    ctx: Context,
):
    """Retrieve the list of existing objects in the current Max patch.

    Use this to understand the current state of the patch, including the
    objects(boxes) and patch cords(lines). The retrieved list contains a
    list of objects including their maxclass, varname for scripting,
    position(patching_rect), and the boxtext when available, as well as a
    list of patch cords with their source and destination information.

    Returns:
        list: A list of objects and patch cords.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_objects_in_patch"}
    response = await maxmsp.send_request(payload, timeout=5.0)

    return [response]


@mcp.tool()
async def get_objects_in_selected(
    ctx: Context,
):
    """Retrieve the list of objects that is selected in a (unlocked) patcher window.

    Use this when the user wanted to reference to the selected objects.

    Returns:
        list: A list of objects and patch cords.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_objects_in_selected"}
    response = await maxmsp.send_request(payload, timeout=5.0)

    return [response]


@mcp.tool()
async def get_object_attributes(ctx: Context, varname: str):
    """Retrieve an objects' attributes and values of the attributes.

    Use this to understand the state of an object.

    Returns:
        list: A list of attributes name and attributes values.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_object_attributes"}
    kwargs = {"varname": varname}
    payload.update(kwargs)
    response = await maxmsp.send_request(payload)

    return [response]


@mcp.tool()
async def get_avoid_rect_position(ctx: Context):
    """When deciding the position to add a new object to the path, this rectangular area
    should be avoid. This is useful when you want to add an object to the patch without
    overlapping with existing objects.

    Returns:
        list: A list of four numbers representing the left, top, right, bottom of the rectangular area.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_avoid_rect_position"}
    response = await maxmsp.send_request(payload)

    return response


# ========================================
# Subpatcher navigation tools:


@mcp.tool()
async def create_subpatcher(
    ctx: Context,
    position: list,
    varname: str,
    name: str = "subpatch",
):
    """Create a new subpatcher (p object) in the current patcher context.

    After creating, use enter_subpatcher to navigate inside and add objects.
    The subpatcher will have no inlets/outlets initially - add them with add_subpatcher_io.

    Args:
        position (list): Position in the Max patch as [x, y].
        varname (str): Variable name for the subpatcher object (used to enter it later).
        name (str): Display name shown in the subpatcher title bar.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "create_subpatcher"}
    kwargs = {
        "position": position,
        "varname": varname,
        "name": name,
    }
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def enter_subpatcher(ctx: Context, varname: str):
    """Navigate into a subpatcher to add/modify objects inside it.

    After entering, all object operations (add_max_object, connect_max_objects, etc.)
    will operate within this subpatcher context.

    Use exit_subpatcher to return to the parent patcher.

    Args:
        varname (str): Variable name of the subpatcher object to enter.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "enter_subpatcher"}
    kwargs = {"varname": varname}
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


@mcp.tool()
async def exit_subpatcher(ctx: Context):
    """Exit the current subpatcher and return to the parent patcher.

    If already at root level, this has no effect.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "exit_subpatcher"}
    await maxmsp.send_command(cmd)


@mcp.tool()
async def get_patcher_context(ctx: Context):
    """Get information about the current patcher navigation context.

    Returns the depth (0 = root), path of subpatcher names, and whether at root.

    Returns:
        dict: Context info with 'depth', 'path' (list of varnames), and 'is_root'.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_patcher_context"}
    response = await maxmsp.send_request(payload)
    return response


@mcp.tool()
async def add_subpatcher_io(
    ctx: Context,
    position: list,
    io_type: str,
    varname: str,
    comment: str = "",
):
    """Add an inlet or outlet object inside a subpatcher.

    These create the connection points visible on the parent patcher's subpatcher object.
    Must be called while inside a subpatcher (after enter_subpatcher).

    Args:
        position (list): Position as [x, y]. Inlets should be at top, outlets at bottom.
        io_type (str): One of "inlet", "outlet", "inlet~", or "outlet~".
        varname (str): Variable name for the io object.
        comment (str): Optional assistance text shown when hovering over the inlet/outlet.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "add_subpatcher_io"}
    kwargs = {
        "position": position,
        "io_type": io_type,
        "varname": varname,
        "comment": comment,
    }
    cmd.update(kwargs)
    await maxmsp.send_command(cmd)


# ========================================
# Object manipulation enhancements:


@mcp.tool()
async def get_object_connections(ctx: Context, varname: str):
    """Get all connections (inputs and outputs) for a specific object.

    Returns connection information that can be used to restore connections
    after recreating an object with different arguments.

    Args:
        varname (str): Variable name of the object.

    Returns:
        dict: Contains 'inputs' (connections coming INTO this object) and
              'outputs' (connections going OUT of this object).
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "get_object_connections", "varname": varname}
    response = await maxmsp.send_request(payload)
    return response


@mcp.tool()
async def recreate_with_args(
    ctx: Context,
    varname: str,
    new_args: list,
):
    """Recreate an existing object with new arguments, preserving all connections.

    This is an atomic operation that:
    1. Gets the object's current position, type, and connections
    2. Removes the object
    3. Creates a new object with the same type but new arguments
    4. Restores all input and output connections

    Useful for changing object parameters that can only be set at creation time.

    Args:
        varname (str): Variable name of the object to recreate.
        new_args (list): New arguments for the object.

    Returns:
        dict: Status of the operation including any errors.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "recreate_with_args", "varname": varname, "new_args": new_args}
    response = await maxmsp.send_request(payload, timeout=5.0)
    return response


@mcp.tool()
async def move_object(
    ctx: Context,
    varname: str,
    x: int,
    y: int,
):
    """Move an object to a new position in the patch.

    Args:
        varname (str): Variable name of the object to move.
        x (int): New x coordinate (pixels from left).
        y (int): New y coordinate (pixels from top).

    Returns:
        dict: Status of the operation.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "move_object", "varname": varname, "x": x, "y": y}
    response = await maxmsp.send_request(payload)
    return response


@mcp.tool()
async def autofit_existing(
    ctx: Context,
    varname: str,
):
    """Apply auto-fit sizing to an existing object.

    Resizes the object width to fit its text content.
    Skips UI objects like toggle, button, slider, etc.

    Args:
        varname (str): Variable name of the object to resize.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    cmd = {"action": "autofit_existing", "varname": varname}
    await maxmsp.send_command(cmd)


@mcp.tool()
async def check_signal_safety(ctx: Context):
    """Analyze the current patch for potentially dangerous signal patterns.

    Checks for:
    - Dangerous feedback loops (excludes valid tapout~ -> tapin~ patterns)
    - High gain *~ objects (> 1.0)
    - Unsafe comb~ feedback values (>= 1.0)
    - Missing limiter (clip~, tanh~, etc.) before dac~

    Returns:
        dict: Contains 'warnings' list and 'safe' boolean.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {"action": "check_signal_safety"}
    response = await maxmsp.send_request(payload, timeout=5.0)
    return response


@mcp.tool()
async def encapsulate(
    ctx: Context,
    varnames: list,
    subpatcher_name: str,
    subpatcher_varname: str,
):
    """Encapsulate a set of objects into a new subpatcher.

    This is similar to Max's Edit > Encapsulate command. It takes the specified
    objects, moves them into a new subpatcher, and automatically creates inlets
    and outlets to preserve all external connections.

    Args:
        varnames (list): List of varnames of objects to encapsulate.
        subpatcher_name (str): Display name for the subpatcher (shown in title bar).
        subpatcher_varname (str): Variable name for the subpatcher object.

    Returns:
        dict: Status including number of objects encapsulated, inlets/outlets created.
    """
    maxmsp = ctx.request_context.lifespan_context.get("maxmsp")
    payload = {
        "action": "encapsulate",
        "varnames": varnames,
        "subpatcher_name": subpatcher_name,
        "subpatcher_varname": subpatcher_varname,
    }
    response = await maxmsp.send_request(payload, timeout=10.0)
    return response


if __name__ == "__main__":
    mcp.run()
