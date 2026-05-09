---
name: knowledge-qa
description: Answer policy and process questions from permission-filtered knowledge base chunks.
intents: [knowledge_qa, mixed]
triggers: [制度, 政策, 流程, 标准, 手册, 报销, 试用期, 年假, 病假]
planning_style: guided
primitives: [retrieve]
---

# Knowledge QA Skill

Use this skill when the user asks about policies, procedures, standards, employee handbook content, or internal rules.

Retrieve relevant knowledge chunks first. Answer only from accessible chunks and include concise source references. If no reliable chunk is found, say that there is not enough accessible evidence instead of inventing a policy.

If the user is inside an unfinished workflow but asks a clear policy question, the runtime may exit the workflow and route here.
