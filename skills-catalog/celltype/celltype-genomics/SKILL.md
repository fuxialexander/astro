---
name: celltype-genomics
version: "1.0.0"
description: "Genomic variant analysis, GWAS, eQTL, and genetic evidence tools"
category: tools
tags: [celltype, genomics, gwas, eqtl, variants, mendelian-randomization]
allowedTools: [Bash, Read, Write]
---

## Genomics & Variant Tools (celltype/cli)

Available tools for genomic analysis:

- **genomics.gwas_lookup** — Query GWAS Catalog for genetic associations
- **genomics.eqtl_lookup** — Query GTEx for eQTLs across tissues
- **genomics.variant_annotate** — Ensembl VEP variant annotation
- **genomics.mendelian_randomization_lookup** — MR evidence from Open Targets
- **genomics.coloc** — GWAS-eQTL/pQTL colocalization from Open Targets

**DNA tools:**
- **dna.reverse_complement**, **dna.translate**, **dna.find_orfs** — Sequence manipulation
- **dna.codon_optimize** — Codon optimization for host species
- **dna.restriction_sites**, **dna.virtual_digest** — Restriction analysis
- **dna.primer_design**, **dna.pcr_protocol** — PCR primer design
- **dna.gibson_design**, **dna.golden_gate_design** — Assembly design

**Data APIs:**
- **data_api.ensembl_lookup** — Ensembl gene/transcript/variant info
- **data_api.ncbi_gene** — NCBI Gene, ClinVar, dbSNP
- **data_api.myvariant_lookup** — MyVariant.info

**Workflow:** GWAS associations → eQTL colocalization → variant annotation → Mendelian randomization → causal gene prioritization.
