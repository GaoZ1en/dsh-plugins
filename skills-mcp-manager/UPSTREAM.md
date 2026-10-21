# Upstream provenance and attribution

This koishi fork derives from [zebbkira/dsh-skills-mcp-manager](https://github.com/zebbkira/dsh-skills-mcp-manager) at commit [`ab57b1c4265e13008b108de460a71680f3366223`](https://github.com/zebbkira/dsh-skills-mcp-manager/tree/ab57b1c4265e13008b108de460a71680f3366223), upstream version `0.2.0`. The original local clone was made on 2026-10-20. This sharing repository contains a source snapshot, not the upstream Git database; upstream history remains available at the fixed link.

## Verified license declaration

Checked on 2026-10-21:

- The [upstream manifest at that exact commit](https://raw.githubusercontent.com/zebbkira/dsh-skills-mcp-manager/ab57b1c4265e13008b108de460a71680f3366223/package.json) declares `"license": "MIT"`.
- The [official npm record for version 0.2.0](https://registry.npmjs.org/@zebbkira%2fdsh-skills-mcp-manager/0.2.0) also declares `MIT`, with `gitHead` equal to the same full commit hash.
- No standalone license file or filled-in copyright line was found in the inspected upstream baseline. Absence of that file is not being treated as absence of the explicit MIT declaration.
- This distribution adds the [MIT license terms](<LICENSE>), corresponding to the [SPDX MIT reference](https://spdx.org/licenses/MIT.html), to record the existing declaration. The added file is not represented as an upstream original, a fresh upstream permission grant, or a fabricated upstream copyright notice.

## Factual attribution

The upstream Git history through the pinned commit records author names **leming** and **Lucas**. [The baseline commit](https://github.com/zebbkira/dsh-skills-mcp-manager/commit/ab57b1c4265e13008b108de460a71680f3366223) and [the Lucas-authored commit](https://github.com/zebbkira/dsh-skills-mcp-manager/commit/8092f2df3fb6869f9b274406c67354c24d47d4e4) are associated with the GitHub account **zebbkira**. The npm release records publisher/maintainer **zebbkirale**. These are provenance facts, not assertions that the aliases identify distinct people or establish particular copyright ownership or dates.

Local modifications, adaptation to DSH 0.2.1-rc.2, and the original book/check icon are by **koishi**. Local changes include the separate package/row/API/state namespace, current SDK integration, DSH-only skill policies, native MCP lifecycle toggles, permission boundaries, regression tests, and bilingual UI metadata. This is not an official DeepSeek product or an upstream-endorsed release. It has not been published to npm.

The repository-level license does not replace upstream or external dependency terms. Dependencies are not vendored into this repository; their own license and notice requirements continue to apply. Target runtime: DeepSeek Harness **0.2.1-rc.2**, without a compatibility exemption.
