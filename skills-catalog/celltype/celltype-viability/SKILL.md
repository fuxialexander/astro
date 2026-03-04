---
name: celltype-viability
version: "1.0.0"
description: "Cell viability dose-response, tissue selectivity, and drug repurposing tools"
category: tools
tags: [celltype, viability, dose-response, drug-repurposing, prism, connectivity-map]
allowedTools: [Bash, Read, Write]
---

## Viability & Drug Repurposing Tools (celltype/cli)

Available tools for viability and drug activity analysis:

- **viability.dose_response** — Dose-response curves from PRISM screening data
- **viability.tissue_selectivity** — Tissue/cancer type selectivity analysis
- **viability.compare_compounds** — Cross-compound potency comparison

**Drug repurposing:**
- **repurposing.cmap_query** — Drug repurposing via connectivity map
- **clue.connectivity_query** — Connectivity map gene set queries

**Imaging:**
- **imaging.cellpainting_lookup** — Cell Painting compound bioactivity
- **imaging.morphology_similarity** — Structural similarity as phenotypic proxy

**Statistics:**
- **statistics.dose_response_fit** — 4-parameter logistic (Hill equation) IC50 fitting
- **statistics.survival_analysis** — Kaplan-Meier with log-rank test
- **statistics.enrichment_test** — Hypergeometric ORA with FDR correction

**Workflow:** Dose-response analysis → tissue selectivity → compound comparison → connectivity map query → repurposing candidates.
