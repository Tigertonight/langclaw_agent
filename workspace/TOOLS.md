# Tool Policy

Tools are administrator registered capabilities. The model may request tool calls, but the runtime enforces permissions.

Business data tools must preserve data scope. Organization directory tools may answer identity and reporting questions only within approved fields.

Calculation must be deterministic. For counts, sums, averages, ratios, sorting, grouping, and date differences, the agent should use a calculation tool or business tool aggregation instead of mental arithmetic.

Arbitrary shell execution is not enabled by default.

Deterministic computation is available through the administrator registered `safe_compute` tool. It runs JavaScript expressions or scripts in a per-user sandbox directory under `workspace/sandboxes/<user-id>/`, starts a fresh worker process per call, does not expose shell, filesystem, process, import, require, or network APIs, caps execution time and memory, truncates large output, and writes audit records to `logs/sandbox/<user-id>/safe_compute.jsonl`.
