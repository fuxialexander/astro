---
name: celltype-clinical
version: "1.0.0"
description: "Clinical trial search, indication mapping, and competitive landscape tools"
category: tools
tags: [celltype, clinical, trials, indication-mapping, regulatory, experiment-design]
allowedTools: [Bash, Read, Write]
---

## Clinical Development Tools (celltype/cli)

Available tools for clinical development planning:

- **clinical.indication_map** — Map sensitivity profiles to cancer indications
- **clinical.population_size** — Patient population estimation (SEER incidence)
- **clinical.tcga_stratify** — TCGA stratification analysis
- **clinical.trial_search** — Clinical trial search
- **clinical.trial_design_benchmark** — Trial design pattern benchmarking
- **clinical.endpoint_benchmark** — Endpoint benchmarking
- **clinical.competitive_landscape** — Competitive landscape analysis

**Regulatory tools:**
- **regulatory.cdisc_lint** — CDISC tabular dataset linting
- **regulatory.define_xml_lint** — Define-XML validation
- **regulatory.submission_package_check** — Cross-file submission QC

**Experiment design:**
- **experiment.list_assays** — Available assay templates
- **experiment.design_assay** — Detailed experimental protocol generation
- **experiment.estimate_timeline** — Time/cost estimation for experiments

**Workflow:** Indication mapping → population sizing → trial search → competitive landscape → trial design → protocol generation.
