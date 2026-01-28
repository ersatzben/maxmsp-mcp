
autowatch = 1; // 1
inlets = 1; // Receive network messages here
outlets = 3; // For status, responses, etc.

// Subpatcher navigation state
var root_patcher = this.patcher;
var current_patcher = this.patcher;
var patcher_stack = [];  // Stack of {patcher, name} for navigation history

// Legacy alias - some functions still use 'p'
var p = this.patcher;

var obj_count = 0;
var boxes = [];
var lines = [];

// Preflight check: track get_avoid_rect_position calls
var avoid_rect_called = false;
var objects_since_avoid_check = 0;
var MAX_OBJECTS_WITHOUT_CHECK = 20;  // Require re-check after this many objects

// Large patch warning
var objects_added_counter = 0;
var OBJECT_COUNT_CHECK_INTERVAL = 10;
var LARGE_PATCH_THRESHOLD = 80;

// Signal safety auto-check (triggers every N MSP objects created)
var msp_objects_counter = 0;
var MSP_SAFETY_CHECK_INTERVAL = 10;

function safe_parse_json(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        outlet(0, "error", "Invalid JSON: " + e.message);
        return null;
    }
}

function split_long_string(inString, maxLength) {
    // var longString = inString.replace(/\s+/g, "");
    var result = [];
    for (var i = 0; i < inString.length; i += maxLength) {
        result.push(inString.substring(i, i + maxLength));
    }
    return result;
}

function count_root_patcher_objects() {
    var count = 0;
    // Use apply (not applydeep) to only count objects in root patcher
    root_patcher.apply(function(obj) {
        // Skip patchlines and internal objects
        if (obj.maxclass && obj.maxclass !== "patchline") {
            count++;
        }
    });
    return count;
}

function check_large_patch_warning() {
    objects_added_counter++;
    if (objects_added_counter >= OBJECT_COUNT_CHECK_INTERVAL) {
        objects_added_counter = 0;
        var count = count_root_patcher_objects();
        if (count > LARGE_PATCH_THRESHOLD) {
            return "WARNING: Large patch (" + count + " objects in root patcher). Consider using encapsulate() to organize into subpatchers.";
        }
    }
    return null;
}

// Called when a message arrives at inlet 0 (from [udpreceive] or similar)
function anything() {
    var msg = arrayfromargs(messagename, arguments).join(" ");
    var data = safe_parse_json(msg);
    if (!data) return;

    switch (data.action) {
        case "fetch_test":
            if (data.request_id) {
                get_objects_in_patch(data.request_id);
            } else {
                outlet(0, "error", "Missing request_id for fetch_test");
            }
            break;
        case "get_objects_in_patch":
            if (data.request_id) {
                get_objects_in_patch(data.request_id);
            } else {
                outlet(0, "error", "Missing request_id for get_objects_in_patch");
            }
            break;
        case "get_objects_in_selected":
            if (data.request_id) {
                get_objects_in_selected(data.request_id);
            } else {
                outlet(0, "error", "Missing request_id for get_objects_in_selected");
            }
            break;
        case "get_object_attributes":
            if (data.request_id && data.varname) {
                get_object_attributes(data.request_id, data.varname);
            } else {
                outlet(0, "error", "Missing request_id or varname for get_object_attributes");
            }
            break;
        case "get_avoid_rect_position":
            if (data.request_id) {
                get_avoid_rect_position(data.request_id);
            }
            break;
        case "add_object":
            if (data.obj_type && data.position && data.varname && data.request_id) {
                add_object(data.position[0], data.position[1], data.obj_type, data.args, data.varname, data.request_id);
            } else {
                outlet(0, "error", "Missing obj_type, position, varname, or request_id for add_object");
            }
            break;
        case "remove_object":
            if (data.varname) {
                remove_object(data.varname);
            } else {
                outlet(0, "error", "Missing varname for remove_object");
            }
            break;
        case "connect_objects":
            if (data.src_varname && data.dst_varname) {
                connect_objects(data.src_varname, data.outlet_idx || 0, data.dst_varname, data.inlet_idx || 0);
            } else {
                outlet(0, "error", "Missing src_varname or dst_varname for connect_objects");
            }
            break;
        case "disconnect_objects":
            if (data.src_varname && data.dst_varname) {
                disconnect_objects(data.src_varname, data.outlet_idx || 0, data.dst_varname, data.inlet_idx || 0);
            } else {
                outlet(0, "error", "Missing src_varname or dst_varname for disconnect_objects");
            }
            break;
        case "set_object_attribute":
            if (data.varname && data.attr_name && data.attr_value) {
                set_object_attribute(data.varname, data.attr_name, data.attr_value);
            } else {
                outlet(0, "error", "Missing varname or attr_name for attr_value");
            }
            break;
        case "set_message_text":
            if (data.varname && data.new_text) {
                set_message_text(data.varname, data.new_text);
            }
            break;
        case "send_message_to_object":
            if (data.varname && data.message) {
                send_message_to_object(data.varname, data.message);
            }
            break;
        case "send_bang_to_object":
            if (data.varname) {
                send_bang_to_object(data.varname);
            }
            break;
        case "set_number":
            if (data.varname && data.num) {
                set_number(data.varname, data.num);
            }
            break;
        case "create_subpatcher":
            if (data.position && data.varname) {
                create_subpatcher(data.position[0], data.position[1], data.name || "subpatch", data.varname);
            } else {
                outlet(0, "error", "Missing position or varname for create_subpatcher");
            }
            break;
        case "enter_subpatcher":
            if (data.varname) {
                enter_subpatcher(data.varname);
            } else {
                outlet(0, "error", "Missing varname for enter_subpatcher");
            }
            break;
        case "exit_subpatcher":
            exit_subpatcher();
            break;
        case "get_patcher_context":
            if (data.request_id) {
                get_patcher_context(data.request_id);
            } else {
                outlet(0, "error", "Missing request_id for get_patcher_context");
            }
            break;
        case "add_subpatcher_io":
            if (data.io_type && data.position && data.varname) {
                add_subpatcher_io(data.position[0], data.position[1], data.io_type, data.varname, data.comment || "");
            } else {
                outlet(0, "error", "Missing io_type, position, or varname for add_subpatcher_io");
            }
            break;
        case "get_object_connections":
            if (data.request_id && data.varname) {
                get_object_connections(data.request_id, data.varname);
            } else {
                outlet(0, "error", "Missing request_id or varname for get_object_connections");
            }
            break;
        case "recreate_with_args":
            if (data.request_id && data.varname && data.new_args !== undefined) {
                recreate_with_args(data.request_id, data.varname, data.new_args);
            } else {
                outlet(0, "error", "Missing request_id, varname, or new_args for recreate_with_args");
            }
            break;
        case "move_object":
            if (data.request_id && data.varname && data.x !== undefined && data.y !== undefined) {
                move_object(data.request_id, data.varname, data.x, data.y);
            } else {
                outlet(0, "error", "Missing request_id, varname, x, or y for move_object");
            }
            break;
        case "autofit_existing":
            if (data.varname) {
                autofit_existing(data.varname);
            } else {
                outlet(0, "error", "Missing varname for autofit_existing");
            }
            break;
        case "encapsulate":
            if (data.request_id && data.varnames && data.subpatcher_name && data.subpatcher_varname) {
                encapsulate(data.request_id, data.varnames, data.subpatcher_name, data.subpatcher_varname);
            } else {
                outlet(0, "error", "Missing request_id, varnames, subpatcher_name, or subpatcher_varname for encapsulate");
            }
            break;
        case "check_signal_safety":
            if (data.request_id) {
                check_signal_safety(data.request_id);
            } else {
                outlet(0, "error", "Missing request_id for check_signal_safety");
            }
            break;
        default:
            outlet(0, "error", "Unknown action: " + data.action);
    }
}

// function fetch_test(request_id) {
// 	var str = get_patcher_objects(request_id)
// 	//outlet(1, request_id)
// }

function add_object(x, y, type, args, var_name, request_id) {
    // Preflight check: require get_avoid_rect_position to be called first
    if (!avoid_rect_called || objects_since_avoid_check >= MAX_OBJECTS_WITHOUT_CHECK) {
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "PREFLIGHT REQUIRED: Call get_avoid_rect_position() before placing objects."
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }
    objects_since_avoid_check++;

    var new_obj = current_patcher.newdefault(x, y, type, args);

    // Check for jbogus - object doesn't exist
    if (new_obj.maxclass === "jbogus") {
        current_patcher.remove(new_obj);
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "OBJECT DOES NOT EXIST: '" + type + "' is not a valid Max object."
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }

    new_obj.varname = var_name;
    if (type == "message" || type == "comment" || type == "flonum") {
        new_obj.message("set", args);
    }
    // Auto-fit width based on text content
    autofit_object(new_obj, type, args);

    // Check for math objects with integer args (type truncation warning)
    var math_objects = ["+", "-", "*", "/", "%", "pow", "scale"];
    var warnings = [];
    if (math_objects.indexOf(type) !== -1 && args && args.length > 0) {
        for (var i = 0; i < args.length; i++) {
            var arg = args[i];
            // Check if it's an integer (number without decimal)
            if (typeof arg === "number" && arg === Math.floor(arg)) {
                warnings.push("WARNING: " + type + " has integer args - will truncate floats! Use " + arg + ". instead of " + arg);
                break;
            }
        }
    }

    // Check for large patch (every N objects)
    var large_patch_warning = check_large_patch_warning();
    if (large_patch_warning) {
        warnings.push(large_patch_warning);
    }

    // Check if this is an MSP object and if we should run signal safety check
    var do_signal_safety = false;
    if (type.charAt(type.length - 1) === "~") {
        msp_objects_counter++;
        if (msp_objects_counter >= MSP_SAFETY_CHECK_INTERVAL) {
            msp_objects_counter = 0;
            do_signal_safety = true;
        }
    }

    if (do_signal_safety) {
        // Route to signal safety check, which will send the response
        run_signal_safety_for_add_object(request_id, warnings);
    } else {
        // Send success response
        var response = warnings.length > 0 ? "ok - " + warnings.join(" | ") : "ok";
        var result = {"request_id": request_id, "results": response};
        outlet(1, "response", JSON.stringify(result));
    }
}

function run_signal_safety_for_add_object(request_id, existing_warnings) {
    var warnings = [];
    var signal_objects = {};
    var signal_connections = [];
    var objects_to_check = [];

    // Collect signal objects and connections
    current_patcher.apply(function(obj) {
        var mc = obj.maxclass;
        if (!mc || mc === "patchline") return;

        if (mc.charAt(mc.length - 1) === "~") {
            var vn = obj.varname;
            if (!vn) {
                vn = "sig-" + Math.floor(Math.random() * 100000);
                obj.varname = vn;
            }
            signal_objects[vn] = { maxclass: mc, varname: vn };

            if (mc === "*~" || mc === "comb~") {
                objects_to_check.push(vn);
            }

            var out_cords = obj.patchcords.outputs;
            if (out_cords) {
                for (var i = 0; i < out_cords.length; i++) {
                    var dst = out_cords[i].dstobject;
                    var dst_mc = dst.maxclass;
                    if (dst_mc && dst_mc.charAt(dst_mc.length - 1) === "~") {
                        var dst_vn = dst.varname || "sig-" + Math.floor(Math.random() * 100000);
                        if (!dst.varname) dst.varname = dst_vn;
                        signal_connections.push({
                            src_varname: vn, src_maxclass: mc,
                            dst_varname: dst_vn, dst_maxclass: dst_mc
                        });
                    }
                }
            }
        }
    });

    // Build adjacency list for cycle detection
    var adj = {};
    for (var i = 0; i < signal_connections.length; i++) {
        var conn = signal_connections[i];
        if (!adj[conn.src_varname]) adj[conn.src_varname] = [];
        adj[conn.src_varname].push({ dst_varname: conn.dst_varname, dst_maxclass: conn.dst_maxclass });
    }

    // Detect feedback loops
    var visited = {};
    var rec_stack = {};

    function detect_cycle(node, path) {
        if (rec_stack[node]) {
            var cycle_start = path.indexOf(node);
            var cycle_path = path.slice(cycle_start);
            var has_tapin = false, tapin_is_direct = false;

            for (var i = 0; i < cycle_path.length; i++) {
                var curr_obj = signal_objects[cycle_path[i]];
                if (curr_obj && curr_obj.maxclass === "tapin~") {
                    has_tapin = true;
                    var prev_idx = (i === 0) ? cycle_path.length - 1 : i - 1;
                    var prev_obj = signal_objects[cycle_path[prev_idx]];
                    if (prev_obj && prev_obj.maxclass === "tapout~") tapin_is_direct = true;
                }
            }

            if (!(has_tapin && tapin_is_direct)) {
                warnings.push({ type: "FEEDBACK_LOOP", message: "Dangerous feedback loop detected", objects: cycle_path });
            }
            return;
        }
        if (visited[node]) return;
        visited[node] = true;
        rec_stack[node] = true;
        path.push(node);
        var neighbors = adj[node] || [];
        for (var i = 0; i < neighbors.length; i++) {
            detect_cycle(neighbors[i].dst_varname, path.slice());
        }
        rec_stack[node] = false;
    }

    for (var vn in signal_objects) {
        if (!visited[vn]) detect_cycle(vn, []);
    }

    // Check for missing limiter before dac~
    var has_dac = false;
    var limiter_types = ["clip~", "tanh~", "saturate~", "limiter~", "limi~", "omx.peaklim~", "omx.comp~"];
    var has_limiter = false;

    for (var vn in signal_objects) {
        var mc = signal_objects[vn].maxclass;
        if (mc === "dac~") has_dac = true;
        if (limiter_types.indexOf(mc) !== -1) has_limiter = true;
    }

    if (has_dac && !has_limiter) {
        warnings.push({ type: "NO_LIMITER", message: "No limiter before dac~. Consider adding clip~ or tanh~." });
    }

    // Route to v8 for gain/feedback arg checking
    var check_data = {
        request_id: request_id,
        is_add_object_response: true,
        existing_warnings: existing_warnings,
        signal_warnings: warnings,
        objects_to_check: objects_to_check
    };
    outlet(2, "complete_signal_safety", JSON.stringify(check_data));
}

// Character width lookup for Arial 12pt (slightly wider to prevent wrapping)
function get_text_width(text) {
    var very_narrow = "il|!.,;:'`1";      // ~4px
    var narrow = "jtfr()-[]{}/ -";         // ~5px
    var medium = "aceszvxyknuhbdgpq023456789"; // ~7px
    var wide = "mwMW@%";                   // ~10px
    // Everything else (uppercase, ~, *, +, etc.): ~8px

    var width = 0;
    for (var i = 0; i < text.length; i++) {
        var c = text[i];
        if (very_narrow.indexOf(c) !== -1) {
            width += 4;
        } else if (narrow.indexOf(c) !== -1) {
            width += 5;
        } else if (medium.indexOf(c) !== -1) {
            width += 7;
        } else if (wide.indexOf(c) !== -1) {
            width += 10;
        } else {
            width += 8;  // default for uppercase, symbols like ~ * +
        }
    }
    return width;
}

function autofit_object(obj, type, args) {
    // Hard skip for inlets/outlets - never resize these
    if (type === "inlet" || type === "outlet") {
        return;
    }

    // Skip UI objects that should keep default sizes
    var skip_types = ["toggle", "button", "slider", "dial", "number", "flonum",
                      "kslider", "panel", "live.dial", "live.slider", "live.toggle",
                      "live.button", "live.numbox", "live.menu", "meter~", "spectroscope~",
                      "gain~", "levelmeter~", "multislider", "matrixctrl", "nodes"];
    if (skip_types.indexOf(type) !== -1) {
        return; // Keep default size
    }

    // Message boxes get fixed 70px width
    if (type === "message") {
        var rect = obj.rect;
        var height = rect[3] - rect[1];
        obj.rect = [rect[0], rect[1], rect[0] + 70, rect[1] + height];
        return;
    }

    // Auto-size: objects and comments
    var text = type;
    if (args && args.length > 0) {
        // Handle array args - join with spaces
        if (Array.isArray(args)) {
            text = type + " " + args.join(" ");
        } else {
            text = type + " " + String(args);
        }
    }

    // Calculate width using character lookup + box padding
    var box_padding = 16;
    var min_width = 32;
    var text_width = get_text_width(text);
    var calculated_width = Math.max(min_width, text_width + box_padding);

    // Get current rect and update width
    var rect = obj.rect;
    var height = rect[3] - rect[1]; // preserve height
    obj.rect = [rect[0], rect[1], rect[0] + calculated_width, rect[1] + height];
}

function remove_object(var_name) {
	var obj = current_patcher.getnamed(var_name);
    if (obj) {
	    current_patcher.remove(obj);
    }
}

function connect_objects(src_varname, outlet_idx, dst_varname, inlet_idx) {
    var src = current_patcher.getnamed(src_varname);
    var dst = current_patcher.getnamed(dst_varname);
    current_patcher.connect(src, outlet_idx, dst, inlet_idx);
}

function disconnect_objects(src_varname, outlet_idx, dst_varname, inlet_idx) {
	var src = current_patcher.getnamed(src_varname);
    var dst = current_patcher.getnamed(dst_varname);
	current_patcher.disconnect(src, outlet_idx, dst, inlet_idx);
}

function set_object_attribute(varname, attr_name, attr_value) {
    var obj = current_patcher.getnamed(varname);
    if (obj) {
        if (obj.maxclass == "message" || obj.maxclass == "comment") {
            if (attr_name == "text") {
                obj.message("set", attr_value);
            }
        }
        // Check if the attribute exists before setting it
        var attrnames = obj.getattrnames();
        if (attrnames.indexOf(attr_name) == -1) {
            post("Attribute not found: " + attr_name);
            return;
        }
        // Set the attribute
        obj.setattr(attr_name, attr_value);
    } else {
        post("Object not found: " + varname);
    }
}

function set_message_text(varname, new_text) {
    var obj = current_patcher.getnamed(varname);
    if (obj) {
        if (obj.maxclass == "message") {
            obj.message("set", new_text);
        } else {
            post("Object is not a message box: " + varname);
        }
    } else {
        post("Object not found: " + varname);
    }
}

function send_message_to_object(varname, message) {
    var obj = current_patcher.getnamed(varname);
    if (obj) {
        obj.message(message);
    } else {
        post("Object not found: " + varname);
    }
}

function send_bang_to_object(varname) {
    var obj = current_patcher.getnamed(varname);
    if (obj) {
        obj.message("bang");
    } else {
        post("Object not found: " + varname);
    }
}

function set_text_in_comment(varname, text) {
    var obj = p.getnamed(varname);
    if (obj) {
        if (obj.maxclass == "comment") {
            obj.message("set", text);
        } else {
            post("Object is not a comment box: " + varname);
        }
    } else {
        post("Object not found: " + varname);
    }
}

function set_number(varname, num) {
    var obj = current_patcher.getnamed(varname);
    if (obj) {
        obj.message("set", num);
    } else {
        post("Object not found: " + varname);
    }
}

// ========================================
// Subpatcher navigation functions:

function create_subpatcher(x, y, name, var_name) {
    var new_obj = current_patcher.newdefault(x, y, "patcher", name);
    new_obj.varname = var_name;
    post("Created subpatcher: " + var_name + " (" + name + ")\n");
}

function enter_subpatcher(var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        post("Object not found: " + var_name + "\n");
        return;
    }

    var subpatch = obj.subpatcher();
    if (!subpatch) {
        post("Object is not a subpatcher: " + var_name + "\n");
        return;
    }

    // Push current context onto stack
    patcher_stack.push({
        patcher: current_patcher,
        name: var_name
    });

    // Navigate into subpatcher
    current_patcher = subpatch;
    post("Entered subpatcher: " + var_name + " (depth: " + patcher_stack.length + ")\n");
}

function exit_subpatcher() {
    if (patcher_stack.length == 0) {
        post("Already at root patcher\n");
        return;
    }

    var context = patcher_stack.pop();
    current_patcher = context.patcher;
    post("Exited to parent patcher (depth: " + patcher_stack.length + ")\n");
}

function get_patcher_context(request_id) {
    var path = [];
    for (var i = 0; i < patcher_stack.length; i++) {
        path.push(patcher_stack[i].name);
    }

    var context = {
        depth: patcher_stack.length,
        path: path,
        is_root: (patcher_stack.length == 0)
    };

    var results = {"request_id": request_id, "results": context};
    outlet(1, "response", JSON.stringify(results, null, 0));
}

function add_subpatcher_io(x, y, io_type, var_name, comment) {
    // io_type should be "inlet" or "outlet" (they auto-detect signal vs message)
    if (io_type != "inlet" && io_type != "outlet") {
        post("Invalid io_type: " + io_type + ". Use inlet or outlet (no ~ needed, they auto-detect)\n");
        return;
    }

    var new_obj = current_patcher.newdefault(x, y, io_type);
    new_obj.varname = var_name;

    if (comment) {
        new_obj.setattr("comment", comment);
    }

    post("Created " + io_type + ": " + var_name + "\n");
}

// ========================================
// fetch request:

function get_objects_in_patch(request_id) {
    obj_count = 0;
    boxes = [];
    lines = [];

    // Use apply (not applydeep) to only get objects in current patcher, not nested
    current_patcher.apply(collect_objects);
    var patcher_dict = {};
    patcher_dict["boxes"] = boxes;
    patcher_dict["lines"] = lines;

    // use these if no v8:
    // var results = {"request_id": request_id, "results": patcher_dict}
    // outlet(1, "response", split_long_string(JSON.stringify(results, null, 2), 2000));

    // use this if has v8:
    outlet(2, "add_boxtext", request_id, JSON.stringify(patcher_dict, null, 0));
}

function get_objects_in_selected(request_id) {
    obj_count = 0;
    boxes = [];
    lines = [];

    current_patcher.applyif(collect_objects, function (obj) {
        return obj.selected;
    });
    var patcher_dict = {};
    patcher_dict["boxes"] = boxes;
    patcher_dict["lines"] = lines;

    // use these if no v8:
    // var results = {"request_id": request_id, "results": patcher_dict}
    // outlet(1, "response", split_long_string(JSON.stringify(results, null, 2), 2000));

    // use this if has v8:
    outlet(2, "add_boxtext", request_id, JSON.stringify(patcher_dict, null, 0));
}

function collect_objects(obj) {
    //var keys = Object.keys(obj.varname);
    //post(typeof obj.varname + "\n");
    if (obj.varname.substring(0, 8) == "maxmcpid"){
        return;
    }
    if (!obj.varname){
        obj.varname = "obj-" + obj_count;
    }
    obj_count+=1;

    var outputs = obj.patchcords.outputs;
    if (outputs.length){
        for (var i = 0; i < outputs.length; i++) {
            lines.push({patchline: {
                source: [obj.varname, outputs[i].srcoutlet],
                destination: [outputs[i].dstobject.varname, outputs[i].dstinlet]
            }})
        }
    }
    var attrnames = obj.getattrnames();
    var attr = {};
    if (attrnames.length){
        for (var i = 0; i < attrnames.length; i++) {
            var name = attrnames[i];
            var value = obj.getattr(name);
            attr[name] = value;
        }
    }
    boxes.push({box:{
        maxclass: obj.maxclass,
        varname: obj.varname,
        patching_rect: obj.rect,
        // numinlets: obj.patchcords.inputs.length,
        // numoutputs: obj.patchcords.outputs.length,
        // attributes: attr,
    }})
}

function get_object_attributes(request_id, var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        post("Object not found: " + var_name);
	    return;
    }
    var attrnames = obj.getattrnames();
    var attributes = {};
    if (attrnames.length){
        for (var i = 0; i < attrnames.length; i++) {
            var name = attrnames[i];
            var value = obj.getattr(name);
            attributes[name] = value;
        }
    }

    // use these if no v8:
    // var results = {"request_id": request_id, "results": patcher_dict}
    // outlet(1, "response", split_long_string(JSON.stringify(results, null, 2), 2000));

    // use this if has v8:
    var results = {"request_id": request_id, "results": attributes}
    outlet(1, "response", split_long_string(JSON.stringify(results, null, 0), 2500));
}

function get_window_rect() {
    var w = this.patcher.wind;
    var title = w.title;
    var size = w.size;
    // outlet(1, "response", split_long_string(JSON.stringify(results, null, 0), 2500));
}

function get_avoid_rect_position(request_id) {
    var l, t, r, b;
    current_patcher.apply(function (obj) {
        // Skip objects without valid rects (like patchlines)
        if (!obj.rect || obj.rect[2] <= obj.rect[0]) {
            return;
        }
        if (obj.rect[0] < l || l == undefined) {
            l = obj.rect[0];
        }
        if (obj.rect[1] < t || t == undefined) {
            t = obj.rect[1];
        }
        if (obj.rect[2] > r || r == undefined) {
            r = obj.rect[2];
        }
        if (obj.rect[3] > b || b == undefined) {
            b = obj.rect[3];
        }
    });
    var avoid_rect = [l, t, r, b];

    // Mark preflight check as done
    avoid_rect_called = true;
    objects_since_avoid_check = 0;

    // use this if has v8:
    var results = {"request_id": request_id, "results": avoid_rect}
    outlet(1, "response", JSON.stringify(results, null, 1));
}

// ========================================
// Object manipulation enhancements:

function get_object_connections(request_id, var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        var results = {"request_id": request_id, "results": {"error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(results, null, 0));
        return;
    }

    var inputs = [];
    var outputs = [];

    // Get output connections (from this object to others)
    var out_cords = obj.patchcords.outputs;
    if (out_cords && out_cords.length) {
        for (var i = 0; i < out_cords.length; i++) {
            outputs.push({
                src_outlet: out_cords[i].srcoutlet,
                dst_varname: out_cords[i].dstobject.varname,
                dst_inlet: out_cords[i].dstinlet
            });
        }
    }

    // Get input connections (from other objects to this one)
    var in_cords = obj.patchcords.inputs;
    if (in_cords && in_cords.length) {
        for (var i = 0; i < in_cords.length; i++) {
            inputs.push({
                src_varname: in_cords[i].srcobject.varname,
                src_outlet: in_cords[i].srcoutlet,
                dst_inlet: in_cords[i].dstinlet
            });
        }
    }

    var connection_info = {
        varname: var_name,
        inputs: inputs,
        outputs: outputs
    };

    var results = {"request_id": request_id, "results": connection_info};
    outlet(1, "response", JSON.stringify(results, null, 0));
}

function recreate_with_args(request_id, var_name, new_args) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        var results = {"request_id": request_id, "results": {"success": false, "error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(results, null, 0));
        return;
    }

    // Store object info
    var obj_type = obj.maxclass;
    var rect = obj.rect;
    var x = rect[0];
    var y = rect[1];

    // Store all connections
    var inputs = [];
    var outputs = [];

    var out_cords = obj.patchcords.outputs;
    if (out_cords && out_cords.length) {
        for (var i = 0; i < out_cords.length; i++) {
            outputs.push({
                src_outlet: out_cords[i].srcoutlet,
                dst_varname: out_cords[i].dstobject.varname,
                dst_inlet: out_cords[i].dstinlet
            });
        }
    }

    var in_cords = obj.patchcords.inputs;
    if (in_cords && in_cords.length) {
        for (var i = 0; i < in_cords.length; i++) {
            inputs.push({
                src_varname: in_cords[i].srcobject.varname,
                src_outlet: in_cords[i].srcoutlet,
                dst_inlet: in_cords[i].dstinlet
            });
        }
    }

    // Remove the old object
    current_patcher.remove(obj);

    // Create new object with new args
    var new_obj = current_patcher.newdefault(x, y, obj_type, new_args);
    new_obj.varname = var_name;

    // Handle special object types
    if (obj_type == "message" || obj_type == "comment" || obj_type == "flonum") {
        new_obj.message("set", new_args);
    }

    // Auto-fit width based on text content
    autofit_object(new_obj, obj_type, new_args);

    // Restore output connections (from this object to others)
    for (var i = 0; i < outputs.length; i++) {
        var dst = current_patcher.getnamed(outputs[i].dst_varname);
        if (dst) {
            current_patcher.connect(new_obj, outputs[i].src_outlet, dst, outputs[i].dst_inlet);
        }
    }

    // Restore input connections (from others to this object)
    for (var i = 0; i < inputs.length; i++) {
        var src = current_patcher.getnamed(inputs[i].src_varname);
        if (src) {
            current_patcher.connect(src, inputs[i].src_outlet, new_obj, inputs[i].dst_inlet);
        }
    }

    var results = {
        "request_id": request_id,
        "results": {
            "success": true,
            "varname": var_name,
            "obj_type": obj_type,
            "new_args": new_args,
            "restored_inputs": inputs.length,
            "restored_outputs": outputs.length
        }
    };
    outlet(1, "response", JSON.stringify(results, null, 0));
    post("Recreated " + var_name + " (" + obj_type + ") with args: " + new_args + "\n");
}

function move_object(request_id, var_name, x, y) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        var results = {"request_id": request_id, "results": {"success": false, "error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(results, null, 0));
        return;
    }

    // Get current rect to preserve width/height
    var rect = obj.rect;
    var width = rect[2] - rect[0];
    var height = rect[3] - rect[1];

    // Set new position while preserving size
    var new_rect = [x, y, x + width, y + height];
    obj.rect = new_rect;

    var results = {
        "request_id": request_id,
        "results": {
            "success": true,
            "varname": var_name,
            "old_position": [rect[0], rect[1]],
            "new_position": [x, y]
        }
    };
    outlet(1, "response", JSON.stringify(results, null, 0));
    post("Moved " + var_name + " to [" + x + ", " + y + "]\n");
}

function autofit_existing(var_name) {
    // Route to v8 add-on which has access to obj.boxtext
    outlet(2, "autofit_v8", var_name);
}

// ========================================
// Signal safety analysis:

function check_signal_safety(request_id) {
    var warnings = [];
    var signal_objects = {};  // varname -> {maxclass, args, boxtext}
    var signal_connections = [];  // {src_varname, src_outlet, dst_varname, dst_inlet}

    // 1. Collect all signal objects and connections
    current_patcher.apply(function(obj) {
        var mc = obj.maxclass;
        if (!mc || mc === "patchline") return;

        // Check if it's a signal object (ends with ~)
        if (mc.charAt(mc.length - 1) === "~") {
            var vn = obj.varname;
            if (!vn) {
                vn = "sig-" + Math.floor(Math.random() * 100000);
                obj.varname = vn;
            }
            signal_objects[vn] = {
                maxclass: mc,
                varname: vn,
                rect: obj.rect
            };

            // Get connections
            var out_cords = obj.patchcords.outputs;
            if (out_cords) {
                for (var i = 0; i < out_cords.length; i++) {
                    var dst = out_cords[i].dstobject;
                    var dst_mc = dst.maxclass;
                    // Only track signal connections
                    if (dst_mc && dst_mc.charAt(dst_mc.length - 1) === "~") {
                        var dst_vn = dst.varname;
                        if (!dst_vn) {
                            dst_vn = "sig-" + Math.floor(Math.random() * 100000);
                            dst.varname = dst_vn;
                        }
                        signal_connections.push({
                            src_varname: vn,
                            src_maxclass: mc,
                            src_outlet: out_cords[i].srcoutlet,
                            dst_varname: dst_vn,
                            dst_maxclass: dst_mc,
                            dst_inlet: out_cords[i].dstinlet
                        });
                    }
                }
            }
        }
    });

    // 2. Collect objects that need arg checking (route to v8)
    var objects_to_check = [];
    for (var vn in signal_objects) {
        var obj = signal_objects[vn];
        if (obj.maxclass === "*~" || obj.maxclass === "comb~") {
            objects_to_check.push(vn);
        }
    }

    // 3. Build adjacency list for cycle detection
    var adj = {};  // src_varname -> [{dst_varname, dst_maxclass}]
    for (var i = 0; i < signal_connections.length; i++) {
        var conn = signal_connections[i];
        if (!adj[conn.src_varname]) {
            adj[conn.src_varname] = [];
        }
        adj[conn.src_varname].push({
            dst_varname: conn.dst_varname,
            dst_maxclass: conn.dst_maxclass,
            src_maxclass: conn.src_maxclass
        });
    }

    // 4. Check for feedback loops (excluding valid tapin~/tapout~ patterns)
    // Valid: tapout~ -> ... -> tapin~ (direct to tapin~ is OK)
    // Invalid: tapout~ -> ... -> something before tapin~ in the chain
    var visited = {};
    var rec_stack = {};

    function detect_cycle(node, path) {
        if (rec_stack[node]) {
            // Found a cycle - check if it's a valid delay feedback
            var cycle_start = path.indexOf(node);
            var cycle_path = path.slice(cycle_start);

            // Check if cycle goes through tapin~
            var has_tapin = false;
            var tapin_is_direct_target = false;

            for (var i = 0; i < cycle_path.length; i++) {
                var curr = cycle_path[i];
                var curr_obj = signal_objects[curr];
                if (curr_obj && curr_obj.maxclass === "tapin~") {
                    has_tapin = true;
                    // Check if the connection TO tapin~ is from tapout~
                    var prev_idx = (i === 0) ? cycle_path.length - 1 : i - 1;
                    var prev = cycle_path[prev_idx];
                    var prev_obj = signal_objects[prev];
                    if (prev_obj && prev_obj.maxclass === "tapout~") {
                        tapin_is_direct_target = true;
                    }
                }
            }

            if (has_tapin && tapin_is_direct_target) {
                // Valid delay feedback - tapout~ connects directly to tapin~
                return false;
            }

            // Invalid feedback loop
            warnings.push({
                type: "FEEDBACK_LOOP",
                message: "Potentially dangerous feedback loop detected",
                objects: cycle_path
            });
            return true;
        }

        if (visited[node]) return false;

        visited[node] = true;
        rec_stack[node] = true;
        path.push(node);

        var neighbors = adj[node] || [];
        for (var i = 0; i < neighbors.length; i++) {
            detect_cycle(neighbors[i].dst_varname, path.slice());
        }

        rec_stack[node] = false;
        return false;
    }

    for (var vn in signal_objects) {
        if (!visited[vn]) {
            detect_cycle(vn, []);
        }
    }

    // 5. Check for missing limiter before dac~
    var has_dac = false;
    var dac_inputs = [];

    for (var i = 0; i < signal_connections.length; i++) {
        var conn = signal_connections[i];
        if (conn.dst_maxclass === "dac~") {
            has_dac = true;
            dac_inputs.push(conn.src_varname);
        }
    }

    if (has_dac) {
        // Check if any limiter objects exist in the patch
        var limiter_types = ["clip~", "tanh~", "saturate~", "limiter~", "omx.peaklim~", "omx.comp~"];
        var has_limiter = false;

        for (var vn in signal_objects) {
            if (limiter_types.indexOf(signal_objects[vn].maxclass) !== -1) {
                has_limiter = true;
                break;
            }
        }

        if (!has_limiter) {
            warnings.push({
                type: "NO_LIMITER",
                message: "No limiter detected before dac~. Consider adding clip~, tanh~, or similar to prevent clipping.",
                suggestion: "Add [clip~ -1. 1.] or [tanh~] before dac~"
            });
        }
    }

    // 6. Route to v8 to check gain/feedback values (needs boxtext access)
    var check_data = {
        request_id: request_id,
        warnings: warnings,
        objects_to_check: objects_to_check,
        signal_objects_count: Object.keys(signal_objects).length,
        signal_connections_count: signal_connections.length
    };
    outlet(2, "complete_signal_safety", JSON.stringify(check_data));
}

// ========================================
// Encapsulate function:

function encapsulate(request_id, varnames, subpatcher_name, subpatcher_varname) {
    // Check if we're at root level - encapsulate only works at root currently
    if (patcher_stack.length > 0) {
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "ENCAPSULATE ERROR: Currently only works at root patcher level. Use exit_subpatcher() to return to root first."
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }

    // 1. Collect objects and validate
    var objects = [];
    var varname_set = {};

    for (var i = 0; i < varnames.length; i++) {
        var vn = varnames[i];
        var obj = current_patcher.getnamed(vn);
        if (!obj) {
            var result = {"request_id": request_id, "results": {
                "success": false,
                "error": "Object not found: " + vn
            }};
            outlet(1, "response", JSON.stringify(result));
            return;
        }
        varname_set[vn] = true;
        objects.push({
            varname: vn,
            obj: obj,
            maxclass: obj.maxclass,
            rect: obj.rect
        });
    }

    if (objects.length === 0) {
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "No objects to encapsulate"
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }

    // 2. Analyze connections
    var internal_connections = [];
    var external_inputs = [];
    var external_outputs = [];

    for (var i = 0; i < objects.length; i++) {
        var obj = objects[i].obj;
        var vn = objects[i].varname;

        // Check outputs
        var out_cords = obj.patchcords.outputs;
        if (out_cords) {
            for (var j = 0; j < out_cords.length; j++) {
                var dst_obj = out_cords[j].dstobject;
                var dst_vn = dst_obj.varname;
                // Assign varname if missing
                if (!dst_vn) {
                    dst_vn = "obj-ext-" + Math.floor(Math.random() * 10000);
                    dst_obj.varname = dst_vn;
                }
                if (varname_set[dst_vn]) {
                    internal_connections.push({
                        src_varname: vn,
                        src_outlet: out_cords[j].srcoutlet,
                        dst_varname: dst_vn,
                        dst_inlet: out_cords[j].dstinlet
                    });
                } else {
                    external_outputs.push({
                        src_varname: vn,
                        src_outlet: out_cords[j].srcoutlet,
                        dst_varname: dst_vn,
                        dst_inlet: out_cords[j].dstinlet
                    });
                }
            }
        }

        // Check inputs
        var in_cords = obj.patchcords.inputs;
        if (in_cords) {
            for (var j = 0; j < in_cords.length; j++) {
                var src_obj = in_cords[j].srcobject;
                var src_vn = src_obj.varname;
                // Assign varname if missing
                if (!src_vn) {
                    src_vn = "obj-ext-" + Math.floor(Math.random() * 10000);
                    src_obj.varname = src_vn;
                }
                if (!varname_set[src_vn]) {
                    external_inputs.push({
                        src_varname: src_vn,
                        src_outlet: in_cords[j].srcoutlet,
                        dst_varname: vn,
                        dst_inlet: in_cords[j].dstinlet
                    });
                }
            }
        }
    }

    // 3. Calculate bounding box
    var min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
    for (var i = 0; i < objects.length; i++) {
        var rect = objects[i].rect;
        if (rect[0] < min_x) min_x = rect[0];
        if (rect[1] < min_y) min_y = rect[1];
        if (rect[2] > max_x) max_x = rect[2];
        if (rect[3] > max_y) max_y = rect[3];
    }

    // 4. Create inlet/outlet mappings
    // Group external inputs by (dst_varname, dst_inlet)
    var inlet_map = {};
    var inlet_list = [];

    for (var i = 0; i < external_inputs.length; i++) {
        var ei = external_inputs[i];
        var key = ei.dst_varname + ":" + ei.dst_inlet;
        if (inlet_map[key] === undefined) {
            inlet_map[key] = inlet_list.length;
            inlet_list.push({
                idx: inlet_list.length,
                dst_varname: ei.dst_varname,
                dst_inlet: ei.dst_inlet,
                external: []
            });
        }
        inlet_list[inlet_map[key]].external.push({
            src_varname: ei.src_varname,
            src_outlet: ei.src_outlet
        });
    }

    // Group external outputs by (src_varname, src_outlet)
    var outlet_map = {};
    var outlet_list = [];

    for (var i = 0; i < external_outputs.length; i++) {
        var eo = external_outputs[i];
        var key = eo.src_varname + ":" + eo.src_outlet;
        if (outlet_map[key] === undefined) {
            outlet_map[key] = outlet_list.length;
            outlet_list.push({
                idx: outlet_list.length,
                src_varname: eo.src_varname,
                src_outlet: eo.src_outlet,
                external: []
            });
        }
        outlet_list[outlet_map[key]].external.push({
            dst_varname: eo.dst_varname,
            dst_inlet: eo.dst_inlet
        });
    }

    // 5. Create subpatcher at top-left of bounding box
    var sub_obj = current_patcher.newdefault(min_x, min_y, "patcher", subpatcher_name);
    sub_obj.varname = subpatcher_varname;
    var subpatch = sub_obj.subpatcher();

    // 6. Calculate internal layout
    var internal_offset_x = 50;
    var internal_offset_y = 50 + (inlet_list.length > 0 ? 40 : 0);
    var outlet_y = (max_y - min_y) + internal_offset_y + 50;

    // 7. Create inlets at top of subpatcher
    var inlet_varnames = [];
    for (var i = 0; i < inlet_list.length; i++) {
        var inlet_x = 50 + i * 80;
        var inlet_vn = "_inlet_" + i;
        var inlet_obj = subpatch.newdefault(inlet_x, 30, "inlet");
        inlet_obj.varname = inlet_vn;
        inlet_varnames.push(inlet_vn);
    }

    // 8. Create outlets at bottom
    var outlet_varnames = [];
    for (var i = 0; i < outlet_list.length; i++) {
        var outlet_x = 50 + i * 80;
        var outlet_vn = "_outlet_" + i;
        var outlet_obj = subpatch.newdefault(outlet_x, outlet_y, "outlet");
        outlet_obj.varname = outlet_vn;
        outlet_varnames.push(outlet_vn);
    }

    // 9. Recreate objects inside subpatcher
    // We need boxtext to get the full object specification - route through v8
    var objects_info = [];
    for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        objects_info.push({
            varname: o.varname,
            maxclass: o.maxclass,
            rect: o.rect,
            new_x: (o.rect[0] - min_x) + internal_offset_x,
            new_y: (o.rect[1] - min_y) + internal_offset_y
        });
    }

    // Send to v8 to complete encapsulation with boxtext access
    var encap_data = {
        request_id: request_id,
        subpatcher_varname: subpatcher_varname,
        objects_info: objects_info,
        internal_connections: internal_connections,
        inlet_list: inlet_list,
        outlet_list: outlet_list,
        inlet_varnames: inlet_varnames,
        outlet_varnames: outlet_varnames,
        varname_set: varname_set
    };
    outlet(2, "complete_encapsulate", JSON.stringify(encap_data));
}

// ========================================
// for debugging use only:


function remove_varname() {
    // for debugging
    // remove all objects' varname
    var p = max.frontpatcher;
    p.applydeep(function (obj) {
        obj.varname = "";
    });
}

function assign_mcp_identifier_to_all_objects() {
    // for debugging
    // remove all objects' varname
	var idx = 0
    var p = max.frontpatcher;
    p.applydeep(function (obj) {
        obj.varname = "maxmcpid-"+idx;
		idx += 1
    });
}


function print_varname() {
    // for debugging
    // remove all objects' varname
    var p = max.frontpatcher;
    p.applydeep(function (obj) {
        post(obj.varname)
    });
}

function parsed_patcher() {
	if (max.frontpatcher.filepath == ""){
		post(NOT_SAVED);
		return;
	}
	var lines = new String();
    var patcher_file = new File(max.frontpatcher.filepath);
    //post("max.frontpatcher.filepath: " + patcher_file + "\n");

	while (patcher_file.position != patcher_file.eof){
		lines += patcher_file.readline();
	}
	patcher_file.close();

    var parsed_patcher = JSON.parse(lines);
	// post(JSON.stringify(parsed_patcher));
}
