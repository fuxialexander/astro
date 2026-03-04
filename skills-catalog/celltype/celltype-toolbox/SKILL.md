---
name: celltype-toolbox
version: "1.0.0"
description: "Celltype/CLI: autonomous drug discovery & biomedical research toolbox with 190+ computational biology tools"
category: tools
tags: [celltype, drug-discovery, biomedical, computational-biology, toolbox, planning]
allowedTools: [Bash, Read, Write]
disableModelInvocation: true
---

## Celltype Toolbox — Available Research Capabilities

You have access to the **celltype/cli** toolbox, an autonomous drug discovery and biomedical research platform with 190+ computational biology tools. These tools run on the user's machine and are available as MCP tools during task execution.

### Tool Categories

**Target Discovery & Validation**
Score degradation targets, predict degron motifs, find co-essential/synthetic lethal partners (DepMap CRISPR), assess druggability, query tissue expression (GTEx + Human Protein Atlas), and retrieve disease associations (Open Targets).

**Structure & Molecular Design**
Predict ternary complexes, batch virtual screening, fetch AlphaFold structures, generate 3D conformers, molecular docking, MD simulation, free energy perturbation, binding site detection.

**Chemistry & SAR**
Compute molecular descriptors (MW, LogP, TPSA, Lipinski), similarity search, SAR analysis, matched molecular pair analysis, scaffold hopping, PubChem lookup, retrosynthesis, pharmacophore modeling, synthetic accessibility scoring.

**Genomics & Variants**
GWAS catalog queries, eQTL lookup (GTEx), variant annotation (VEP), Mendelian randomization evidence, GWAS-eQTL colocalization.

**Transcriptomics & Expression**
Pathway enrichment from L1000 signatures, immune scoring, compound signature similarity, immune deconvolution, TF activity inference, differential expression.

**Single-Cell & Spatial**
Leiden/Louvain clustering, trajectory inference, cell type annotation, spatial transcriptomics clustering, spatial autocorrelation.

**Omics Data Access**
GEO search/fetch, CELLxGENE search/fetch, TCGA search/fetch, DESeq2 differential expression, methylation analysis, proteomics analysis, ATAC-seq peak annotation, ChIP-seq enrichment, Hi-C compartments, multi-omics integration (MOFA+).

**Safety & ADMET**
Anti-target screening, multi-modal safety classification, SALL4 teratogenicity risk, FAERS adverse event signals, FDA label risk extraction, ADMET prediction, drug-drug interaction prediction.

**Clinical Development**
Indication mapping, patient population estimation (SEER), TCGA stratification, clinical trial search, trial design benchmarking, endpoint benchmarking, competitive landscape analysis.

**Protein Analysis**
ESM-2 protein embeddings, UniProt function/domain/PTM data, InterPro domain annotation, protein-protein interaction networks (STRING), pathway crosstalk (Reactome).

**Viability & Biomarkers**
Dose-response curves (PRISM), tissue selectivity, compound comparison, mutation sensitivity, resistance profiling, biomarker panel selection.

**Combination Therapy**
Synergy prediction from anti-correlated signatures, synthetic lethality mining (DepMap), metabolic vulnerability exploitation.

**Literature & Patents**
PubMed search, ChEMBL bioactivity queries, OpenAlex academic search, patent search, preprint search (bioRxiv/medRxiv/arXiv).

**Code Execution**
Python sandbox (pandas, numpy, scipy, sklearn, matplotlib, seaborn, gseapy, pydeseq2, BioPython) and R execution (survival analysis, KEGG, statistical tests).

### Planning with Celltype Tools

When creating plans for biomedical research projects, you can decompose goals into tasks that leverage these tools. Each task should specify which tool category it uses.

Example task types:
- "Query BRCA1 disease associations using Open Targets" → target discovery
- "Analyze differential expression in TCGA breast cancer cohort" → omics/transcriptomics
- "Predict druggability of identified targets" → target validation
- "Search for clinical trials targeting the pathway" → clinical development
- "Run dose-response analysis from PRISM data" → viability analysis

Tasks using celltype tools should:
1. Be specific about which analysis to perform
2. Reference the input data or gene/compound of interest
3. Specify expected outputs (e.g., "ranked list of targets", "pathway enrichment results")
4. Chain logically: upstream analyses feed downstream tasks via dependency outputs
