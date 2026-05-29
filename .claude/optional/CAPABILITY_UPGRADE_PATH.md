# Capability Upgrade Path

## Plugins

Do not make `plugins/` part of the everyday personal folder merely because a diagram shows it. Plugins are a packaging/distribution layer for reusable skills, agents, hooks and MCP servers. Promote this Foundry into a plugin only after its workflows have been stable and useful across several repositories.

## MCP

Project-scoped servers belong in `.mcp.json` at the project root. User-scoped recurring tools are configured outside the checked-in template. Add MCP only when a real project repeatedly needs a capability such as browser automation, design access or issue tracking.

Checklist before enabling any MCP server:
- What data can it read or change?
- Which environment variable or authentication is required?
- Is it project-shared or personal?
- Is there a safer read-only mode?
- What action still requires manual confirmation?

## Channels

Mobile/message bridges are an advanced operating mode, not a baseline. Use them after the project has permission guardrails and a reliable verify/ship loop. Restrict senders; treat any incoming message as untrusted; never let a chat message trigger release/destructive operations without approval.

## Hooks

Hooks are appropriate for deterministic enforcement:
- block secret-bearing file writes,
- format a changed file,
- run a known safe check,
- send a notification.

Hooks are not appropriate for broad taste judgments, architecture decisions or hidden autonomous release pipelines.
