
autowatch = 1; // 1
inlets = 1; // Receive network messages here
outlets = 2; // For status, responses, etc.

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


function anything() {
    var a = arrayfromargs(messagename, arguments);
    switch (messagename) {
        case "add_boxtext":
            if (arguments.length < 2) {
                post("add_boxtext: need two args: request_id, stringified_patcher_dict \n");
                return;
            }
            add_boxtext(arguments[0], arguments[1]);
            break;
        case "autofit_v8":
            if (arguments.length < 1) {
                post("autofit_v8: need varname arg\n");
                return;
            }
            autofit_v8(arguments[0]);
            break;
        case "complete_encapsulate":
            if (arguments.length < 1) {
                post("complete_encapsulate: need encap_data arg\n");
                return;
            }
            complete_encapsulate(arguments[0]);
            break;
        case "complete_signal_safety":
            if (arguments.length < 1) {
                post("complete_signal_safety: need check_data arg\n");
                return;
            }
            complete_signal_safety(arguments[0]);
            break;
        default:
            // outlet(1, messagename, ...arguments);
            outlet(1, "response", arguments[1]);
    }
}

function add_boxtext(request_id, data){
    // post(patcher_dict + "\n");
    var patcher_dict = safe_parse_json(data);
    var p = this.patcher;

    patcher_dict.boxes.forEach(function (b) {
        var obj = p.getnamed(b.box.varname);
        if (obj) {
            b.box["text"] = obj.boxtext;
        }
    });

    var results = {"request_id": request_id, "results": patcher_dict}
    outlet(1, "response", split_long_string(JSON.stringify(results, null, 0), 2500));
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

function complete_signal_safety(data_str) {
    var data = safe_parse_json(data_str);
    if (!data) return;

    var p = this.patcher;
    var request_id = data.request_id;
    var warnings = data.warnings || [];
    var objects_to_check = data.objects_to_check || [];

    // Check *~ and comb~ objects for dangerous gain/feedback values
    for (var i = 0; i < objects_to_check.length; i++) {
        var vn = objects_to_check[i];
        var obj = p.getnamed(vn);
        if (!obj) continue;

        var boxtext = obj.boxtext || "";
        var parts = boxtext.split(" ");
        var mc = obj.maxclass;

        if (mc === "*~") {
            // Check for gain > 1.0
            // *~ can have 0 or 1 argument (the gain multiplier)
            if (parts.length > 1) {
                var gain = parseFloat(parts[1]);
                if (!isNaN(gain) && gain > 1.0) {
                    warnings.push({
                        type: "HIGH_GAIN",
                        message: "*~ with gain > 1.0 may cause clipping",
                        object: vn,
                        value: gain
                    });
                }
            }
        } else if (mc === "comb~") {
            // comb~ args: maxdelay delay feedback feedforward gain
            // feedback is the 3rd argument (index 3 in parts, since parts[0] is "comb~")
            if (parts.length >= 4) {
                var feedback = parseFloat(parts[3]);
                if (!isNaN(feedback) && Math.abs(feedback) >= 1.0) {
                    warnings.push({
                        type: "UNSAFE_FEEDBACK",
                        message: "comb~ feedback >= 1.0 will cause runaway gain",
                        object: vn,
                        value: feedback
                    });
                }
            }
        }
    }

    // Return results
    if (data.is_add_object_response) {
        // Response for add_object with signal safety check
        // Combine: data.signal_warnings (from js) + warnings (from v8 gain check)
        var all_warnings = data.existing_warnings || [];
        var signal_warnings = (data.signal_warnings || []).concat(warnings);

        // Format signal warnings and add to all_warnings
        if (signal_warnings.length > 0) {
            var signal_msgs = [];
            for (var i = 0; i < signal_warnings.length; i++) {
                var w = signal_warnings[i];
                var msg = "[" + w.type + "] " + w.message;
                if (w.object) msg += " (object: " + w.object + ")";
                if (w.value !== undefined) msg += " value: " + w.value;
                signal_msgs.push(msg);
            }
            all_warnings.push("SIGNAL SAFETY: " + signal_msgs.join(" | "));
        }

        var response_str = all_warnings.length > 0 ? "ok - " + all_warnings.join(" | ") : "ok";
        var result = { "request_id": request_id, "results": response_str };
        outlet(1, "response", JSON.stringify(result));
    } else {
        // Manual check_signal_safety call - send full response
        var result = {
            "request_id": request_id,
            "results": {
                "safe": warnings.length === 0,
                "warnings": warnings,
                "signal_objects_count": data.signal_objects_count,
                "signal_connections_count": data.signal_connections_count
            }
        };
        outlet(1, "response", JSON.stringify(result));
    }
}

// Map internal Max class names to user-facing names
var internal_to_user_class = {
    // Math operators
    "plus~": "+~",
    "times~": "*~",
    "minus~": "-~",
    "div~": "/~",
    "modulo~": "%~",
    // Reverse operators
    "rminus~": "!-~",
    "rdiv~": "!/~",
    // Comparison operators
    "equals~": "==~",
    "notequals~": "!=~",
    "greaterthan~": ">~",
    "greaterthaneq~": ">=~",
    "lessthan~": "<~",
    "lessthaneq~": "<=~"
};

function complete_encapsulate(data_str) {
    var data = safe_parse_json(data_str);
    if (!data) return;

    var p = this.patcher;
    var request_id = data.request_id;
    var subpatcher_varname = data.subpatcher_varname;
    var objects_info = data.objects_info;
    var internal_connections = data.internal_connections;
    var inlet_list = data.inlet_list;
    var outlet_list = data.outlet_list;
    var inlet_varnames = data.inlet_varnames;
    var outlet_varnames = data.outlet_varnames;
    var varname_set = data.varname_set;

    // Get subpatcher
    var sub_obj = p.getnamed(subpatcher_varname);
    if (!sub_obj) {
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "Subpatcher not found: " + subpatcher_varname
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }
    var subpatch = sub_obj.subpatcher();

    // Map old varnames to new internal varnames
    var new_varname_map = {};

    // Recreate objects inside subpatcher using boxtext
    for (var i = 0; i < objects_info.length; i++) {
        var o = objects_info[i];
        var orig_obj = p.getnamed(o.varname);
        if (!orig_obj) {
            post("encapsulate: original object not found: " + o.varname + "\n");
            continue;
        }

        var boxtext = orig_obj.boxtext || "";
        var obj_type = o.maxclass;
        var new_vn = "_enc_" + o.varname;
        var obj_args = [];

        // Get object type from boxtext when available - this preserves user-facing names
        // (e.g., ">~" instead of "greaterthan~", "t" instead of "trigger")
        if (boxtext && obj_type !== "message" && obj_type !== "comment") {
            var boxtext_parts = boxtext.split(" ");
            if (boxtext_parts[0]) {
                obj_type = boxtext_parts[0];  // Use the user-facing name from boxtext
            }
        }

        // Get original dimensions
        var orig_rect = orig_obj.rect;
        var orig_width = orig_rect[2] - orig_rect[0];
        var orig_height = orig_rect[3] - orig_rect[1];

        // Handle different object types
        if (obj_type === "message") {
            // For message boxes, boxtext IS the content
            obj_args = boxtext.split(" ");
            // Convert numeric strings to numbers, but preserve special Max syntax:
            // $1-$9 (variable substitution), \, \; \$ (escapes), commas, semicolons
            for (var j = 0; j < obj_args.length; j++) {
                var arg = obj_args[j];
                // Skip if contains special characters: $, \, comma, semicolon
                if (arg.indexOf("$") !== -1 ||
                    arg.indexOf("\\") !== -1 ||
                    arg.indexOf(",") !== -1 ||
                    arg.indexOf(";") !== -1) {
                    continue;  // Keep as string
                }
                // Only convert pure numeric values
                if (arg.match(/^-?\d*\.?\d+$/)) {
                    var num = parseFloat(arg);
                    if (!isNaN(num)) {
                        // Preserve integer vs float distinction
                        if (arg.indexOf(".") !== -1) {
                            obj_args[j] = num;
                        } else {
                            obj_args[j] = Math.floor(num);
                        }
                    }
                }
            }
        } else if (obj_type === "comment") {
            // For comments, boxtext is the text content - keep as single string
            obj_args = [boxtext];
        } else if (boxtext) {
            // For regular objects, boxtext is "type arg1 arg2..."
            var parts = boxtext.split(" ");
            obj_args = parts.slice(1);  // Skip the type, just get args
            // Convert string numbers back to numbers
            for (var j = 0; j < obj_args.length; j++) {
                var num = parseFloat(obj_args[j]);
                if (!isNaN(num) && obj_args[j].match(/^-?\d*\.?\d+$/)) {
                    // Preserve integer vs float distinction
                    if (obj_args[j].indexOf(".") !== -1) {
                        obj_args[j] = num;
                    } else {
                        obj_args[j] = Math.floor(num);
                    }
                }
            }
        }

        // Create object in subpatcher
        var new_obj = subpatch.newdefault(o.new_x, o.new_y, obj_type, obj_args);
        new_obj.varname = new_vn;
        new_varname_map[o.varname] = new_vn;

        // Set content for message and comment boxes
        if (obj_type === "message" || obj_type === "comment") {
            new_obj.message("set", obj_args);
        }

        // Preserve original dimensions
        var new_rect = new_obj.rect;
        new_obj.rect = [new_rect[0], new_rect[1], new_rect[0] + orig_width, new_rect[1] + orig_height];
    }

    // Reconnect internal connections
    for (var i = 0; i < internal_connections.length; i++) {
        var ic = internal_connections[i];
        var src = subpatch.getnamed(new_varname_map[ic.src_varname]);
        var dst = subpatch.getnamed(new_varname_map[ic.dst_varname]);
        if (src && dst) {
            subpatch.connect(src, ic.src_outlet, dst, ic.dst_inlet);
        }
    }

    // Connect inlets to internal objects
    for (var i = 0; i < inlet_list.length; i++) {
        var il = inlet_list[i];
        var inlet_obj = subpatch.getnamed(inlet_varnames[i]);
        var dst = subpatch.getnamed(new_varname_map[il.dst_varname]);
        if (inlet_obj && dst) {
            subpatch.connect(inlet_obj, 0, dst, il.dst_inlet);
        }
    }

    // Connect internal objects to outlets
    for (var i = 0; i < outlet_list.length; i++) {
        var ol = outlet_list[i];
        var outlet_obj = subpatch.getnamed(outlet_varnames[i]);
        var src = subpatch.getnamed(new_varname_map[ol.src_varname]);
        if (src && outlet_obj) {
            subpatch.connect(src, ol.src_outlet, outlet_obj, 0);
        }
    }

    // Connect external sources to subpatcher inlets (in parent patcher)
    for (var i = 0; i < inlet_list.length; i++) {
        var il = inlet_list[i];
        for (var j = 0; j < il.external.length; j++) {
            var ext = il.external[j];
            var src = p.getnamed(ext.src_varname);
            if (src) {
                p.connect(src, ext.src_outlet, sub_obj, i);
            }
        }
    }

    // Connect subpatcher outlets to external destinations (in parent patcher)
    for (var i = 0; i < outlet_list.length; i++) {
        var ol = outlet_list[i];
        for (var j = 0; j < ol.external.length; j++) {
            var ext = ol.external[j];
            var dst = p.getnamed(ext.dst_varname);
            if (dst) {
                p.connect(sub_obj, i, dst, ext.dst_inlet);
            }
        }
    }

    // Remove original objects
    for (var i = 0; i < objects_info.length; i++) {
        var orig_obj = p.getnamed(objects_info[i].varname);
        if (orig_obj) {
            p.remove(orig_obj);
        }
    }

    // Return success
    var result = {"request_id": request_id, "results": {
        "success": true,
        "subpatcher_varname": subpatcher_varname,
        "objects_encapsulated": objects_info.length,
        "inlets_created": inlet_list.length,
        "outlets_created": outlet_list.length,
        "internal_connections": internal_connections.length
    }};
    outlet(1, "response", JSON.stringify(result));
    post("Encapsulated " + objects_info.length + " objects into " + subpatcher_varname + "\n");
}

function autofit_v8(var_name) {
    var p = this.patcher;
    var obj = p.getnamed(var_name);

    if (!obj) {
        post("autofit_v8: Object not found: " + var_name + "\n");
        return;
    }

    // Hard skip for inlets/outlets - never resize these
    var mc = obj.maxclass;
    if (mc === "inlet" || mc === "outlet") {
        return;
    }

    // Skip UI objects that should keep default sizes
    var skip_classes = ["toggle", "button", "slider", "dial", "number", "flonum",
                        "kslider", "panel", "live.dial", "live.slider", "live.toggle",
                        "live.button", "live.numbox", "live.menu", "meter~", "spectroscope~",
                        "gain~", "levelmeter~", "multislider", "matrixctrl", "nodes"];
    if (skip_classes.indexOf(mc) !== -1) {
        return; // Keep default size
    }

    // Message boxes get fixed 70px width
    if (obj.maxclass === "message") {
        var rect = obj.rect;
        var current_width = rect[2] - rect[0];
        var current_height = rect[3] - rect[1];
        if (current_width !== 70) {
            obj.rect = [rect[0], rect[1], rect[0] + 70, rect[1] + current_height];
            post("autofit_v8 " + var_name + ": " + current_width + "px -> 70px (message)\n");
        }
        return;
    }

    // Auto-size: objects and comments
    var text = obj.boxtext;
    if (!text) {
        text = obj.maxclass;
    }

    var rect = obj.rect;
    var current_width = rect[2] - rect[0];
    var current_height = rect[3] - rect[1];

    // Calculate width using character lookup + box padding
    var box_padding = 16;
    var min_width = 32;
    var text_width = get_text_width(text);
    var calculated_width = Math.max(min_width, text_width + box_padding);

    // Only resize if significantly different
    if (Math.abs(current_width - calculated_width) > 3) {
        obj.rect = [rect[0], rect[1], rect[0] + calculated_width, rect[1] + current_height];
        post("autofit_v8 " + var_name + ": " + current_width + "px -> " + calculated_width + "px (" + text + ")\n");
    }
}


