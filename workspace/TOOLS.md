# Tool Policy

Tools are administrator registered capabilities. The model may request tool calls, but the runtime enforces permissions.

Business data tools must preserve data scope. Organization directory tools may answer identity and reporting questions only within approved fields.

Calculation must be deterministic. For counts, sums, averages, ratios, sorting, grouping, and date differences, the agent should use a calculation tool or business tool aggregation instead of mental arithmetic.

Arbitrary code execution is not enabled by default. If introduced later, it must run in a restricted sandbox with no access to secrets, no default network, timeouts, memory limits, and audited input/output.
