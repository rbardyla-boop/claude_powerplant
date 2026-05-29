#!/usr/bin/env python3
"""Deny Claude writes to likely secret-bearing files. Reads hook JSON from stdin."""
import json
import re
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    # Fail closed for a security hook whose input cannot be understood.
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "Sensitive-write guard could not parse hook input."
        }
    }))
    raise SystemExit(0)

tool_input = payload.get("tool_input", {})
path = str(tool_input.get("file_path") or tool_input.get("path") or "")
blocked = re.compile(
    r"(^|/)(\.env(\..*)?|secrets?(/|$)|credentials?(\.[^/]*)?$|.*private[-_]?key.*|id_rsa(\..*)?$)",
    re.IGNORECASE,
)

if blocked.search(path):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"Blocked write to sensitive path: {path}"
        }
    }))
