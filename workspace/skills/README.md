# Private Skill Registry

This workspace supports a first-stage private skill registry.

Installed skills are copied into:

- `workspace/skills/installed/<skill-id>/`

Registry state is stored in:

- `workspace/skills/registry.json`

Each installable skill directory should contain:

- `SKILL.md`
- `manifest.json`

Minimal manifest example:

```json
{
  "id": "weekly-report",
  "name": "weekly-report",
  "version": "0.1.0",
  "enabled": true,
  "description": "Generate weekly business reports.",
  "planning_style": "guided",
  "intents": ["mixed"],
  "required_primitives": ["query", "artifact"],
  "required_permissions": [],
  "output_modes": ["report", "answer"]
}
```
