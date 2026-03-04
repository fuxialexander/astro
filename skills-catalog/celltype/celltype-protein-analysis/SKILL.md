---
name: celltype-protein-analysis
version: "1.0.0"
description: "Protein function prediction, embeddings, domain annotation, and interaction network tools"
category: tools
tags: [celltype, protein, embeddings, domain-annotation, ppi, biomarkers]
allowedTools: [Bash, Read, Write]
---

## Protein Analysis Tools (celltype/cli)

Available tools for protein analysis:

- **protein.embed** — ESM-2 protein sequence embeddings (local GPU or API)
- **protein.function_predict** — Comprehensive UniProt function/domain/PTM data
- **protein.domain_annotate** — InterPro domain/family annotation

**Network analysis:**
- **network.ppi_analysis** — STRING protein-protein interaction network
- **network.pathway_crosstalk** — Reactome pathway crosstalk analysis

**Combination therapy:**
- **combination.synergy_predict** — Synergy from anti-correlated L1000 signatures
- **combination.synthetic_lethality** — DepMap synthetic lethality mining
- **combination.metabolic_vulnerability** — Metabolic dependency exploitation

**Biomarker tools:**
- **biomarker.mutation_sensitivity** — Mutation-drug sensitivity testing
- **biomarker.resistance_profile** — Resistance mechanism profiling
- **biomarker.panel_select** — ML-based predictive biomarker panel selection

**Workflow:** Protein function → domain annotation → PPI network → pathway crosstalk → biomarker identification.
