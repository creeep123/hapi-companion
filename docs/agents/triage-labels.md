# Agent Triage Labels

This project uses the default five-role triage vocabulary for local markdown issues.

| Role | Label / status | Meaning |
|---|---|---|
| Needs triage | `needs-triage` | A maintainer / product owner must evaluate this. |
| Needs info | `needs-info` | Waiting for missing product, technical, or reporter information. |
| Ready for agent | `ready-for-agent` | Fully specified and suitable for an AFK implementation agent. |
| Ready for human | `ready-for-human` | Needs human judgment or manual work before implementation. |
| Won't fix | `wontfix` | Will not be actioned. |

For local markdown issues, put the status in frontmatter:

```yaml
status: ready-for-agent
```

Do not create new status names unless the Control Panel records the process change.
