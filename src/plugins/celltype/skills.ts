/**
 * Celltype/CLI Skill Definitions
 *
 * Pure prompt-injection skills describing the celltype/cli bioinformatics toolbox.
 * These run on the user's machine via the celltype MCP server — the Astro server
 * never does compute or file I/O for these tools.
 *
 * Skills are organized by research domain. Each skill describes what tools are
 * available, when to use them, and how they connect to other analysis steps.
 *
 * Source: https://github.com/celltype/cli (~190 tools)
 */

import type { OpenClawSkill } from '@/types/skill'

/**
 * Planning-level overview of the entire celltype toolbox.
 * Injected into plan generation prompts so the planner knows what's possible.
 */
export const celltypeToolboxSkill: OpenClawSkill = {
  name: 'celltype-toolbox',
  description: 'Celltype/CLI: autonomous drug discovery & biomedical research toolbox with 190+ computational biology tools',
  instructions: `## Celltype Toolbox — Available Research Capabilities

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
4. Chain logically: upstream analyses feed downstream tasks via dependency outputs`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
  // Not auto-injected into execution prompts — used for plan generation awareness
  disableModelInvocation: true,
}

/**
 * Category-level skills for execution prompts.
 * These provide detailed tool descriptions for the executing agent.
 */

export const celltypeTargetSkill: OpenClawSkill = {
  name: 'celltype-target-discovery',
  description: 'Target discovery, validation, and druggability assessment tools',
  instructions: `## Target Discovery & Validation Tools (celltype/cli)

Available tools for target identification and validation:

- **target.neosubstrate_score** — Score proteins as degradation targets from proteomics data
- **target.degron_predict** — Predict degron motifs (zinc fingers, disorder) via UniProt features
- **target.coessentiality** — Find co-essential/synthetic lethal partners from DepMap CRISPR screens
- **target.druggability** — Assess druggability via UniProt domains, ligands, and structural coverage
- **target.expression_profile** — Query tissue expression from GTEx + Human Protein Atlas
- **target.disease_association** — Retrieve disease associations from Open Targets

**Data APIs for target research:**
- **data_api.opentargets_search** — Open Targets target/disease/drug profiles
- **data_api.depmap_search** — DepMap gene dependency, expression, mutation data
- **data_api.uniprot_lookup** — UniProt protein information
- **data_api.ensembl_lookup** — Ensembl gene/transcript info
- **data_api.ncbi_gene** — NCBI Gene, ClinVar, dbSNP

**Workflow:** Start with disease associations → validate with expression and essentiality data → assess druggability → characterize protein features.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeStructureSkill: OpenClawSkill = {
  name: 'celltype-structure-design',
  description: 'Protein structure prediction, molecular docking, and drug design tools',
  instructions: `## Structure & Molecular Design Tools (celltype/cli)

Available tools for structural biology and molecular design:

- **structure.alphafold_fetch** — Download AlphaFold predicted structures
- **structure.compound_3d** — Generate 3D conformers from SMILES
- **structure.dock** — Molecular docking (ligand into protein)
- **structure.binding_site** — Detect binding pockets (geometric analysis/fpocket)
- **structure.ternary_predict** — Predict E3-compound-target ternary complex
- **structure.batch_screen** — Batch virtual screening for ternary compatibility
- **structure.md_simulate** — Molecular dynamics simulation (OpenMM/GROMACS)
- **structure.fep** — Free energy perturbation calculations

**Data APIs:**
- **data_api.pdb_search** — RCSB PDB structure search
- **data_api.pdbe_search** — PDBe search

**Workflow:** Fetch structure → identify binding sites → dock compounds → evaluate binding energy → optimize via FEP.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeChemistrySkill: OpenClawSkill = {
  name: 'celltype-chemistry',
  description: 'Chemical analysis, SAR, and medicinal chemistry optimization tools',
  instructions: `## Chemistry & SAR Tools (celltype/cli)

Available tools for chemical analysis and medicinal chemistry:

- **chemistry.descriptors** — MW, LogP, TPSA, Lipinski, fingerprints from SMILES
- **chemistry.pairwise_similarity** — Pairwise Tanimoto similarity matrix
- **chemistry.similarity_search** — Library search by Morgan fingerprint similarity
- **chemistry.sar_analyze** — Structure-activity relationship analysis
- **chemistry.mmp_analysis** — Matched molecular pair analysis
- **chemistry.scaffold_hop** — Scaffold replacements and bioisosteres
- **chemistry.pubchem_lookup** — PubChem compound lookup
- **chemistry.retrosynthesis** — Retrosynthetic route planning
- **chemistry.pharmacophore** — Pharmacophore model from active compounds
- **chemistry.sa_score** — Synthetic accessibility score (1=easy, 10=hard)

**Data APIs:**
- **data_api.chembl_advanced** — ChEMBL compound/target bioactivity
- **data_api.drug_info** — Comprehensive drug pharmacology
- **data_api.mychem_lookup** — MyChem.info compound data

**Workflow:** Look up compound → compute descriptors → SAR analysis → scaffold hopping → assess synthetic accessibility → plan retrosynthesis.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeGenomicsSkill: OpenClawSkill = {
  name: 'celltype-genomics',
  description: 'Genomic variant analysis, GWAS, eQTL, and genetic evidence tools',
  instructions: `## Genomics & Variant Tools (celltype/cli)

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

**Workflow:** GWAS associations → eQTL colocalization → variant annotation → Mendelian randomization → causal gene prioritization.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeTranscriptomicsSkill: OpenClawSkill = {
  name: 'celltype-transcriptomics',
  description: 'Differential expression, pathway enrichment, and transcriptomic analysis tools',
  instructions: `## Transcriptomics & Expression Tools (celltype/cli)

Available tools for expression analysis:

- **expression.pathway_enrichment** — Pathway scoring from L1000 signatures
- **expression.immune_score** — IFN-gamma, antigen presentation, IO scoring
- **expression.l1000_similarity** — Find compounds with similar/opposite transcriptomic signatures
- **expression.deconvolution** — Immune cell type composition from bulk expression
- **expression.tf_activity** — Transcription factor activity inference from regulons
- **expression.diff_expression** — Differential expression between groups

**Omics tools:**
- **omics.deseq2** — Negative binomial differential expression
- **omics.geo_search/fetch** — NCBI GEO dataset search and download
- **omics.tcga_search/fetch** — TCGA/GDC cancer genomics

**Connectivity Map:**
- **clue.compound_signature** — L1000 transcriptomic signature for a compound
- **clue.connectivity_query** — Connectivity map queries by gene set

**Statistics:**
- **statistics.enrichment_test** — Hypergeometric ORA with FDR

**Workflow:** Fetch expression data → differential expression → pathway enrichment → TF activity → connectivity map query → compound signature matching.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeSingleCellSkill: OpenClawSkill = {
  name: 'celltype-single-cell',
  description: 'Single-cell RNA-seq, spatial transcriptomics, and cell type analysis tools',
  instructions: `## Single-Cell & Spatial Analysis Tools (celltype/cli)

Available tools for single-cell and spatial analysis:

- **singlecell.cluster** — Leiden/Louvain clustering with PCA+UMAP (scanpy)
- **singlecell.trajectory** — Trajectory inference with diffusion maps/PAGA
- **singlecell.cell_type_annotate** — Cell type annotation via marker panels/CellTypist

**CELLxGENE tools:**
- **cellxgene.gene_expression** — Single-cell gene expression across tissues/cell types
- **cellxgene.cell_type_markers** — Marker genes for cell types
- **cellxgene.dataset_search** — Dataset discovery in CELLxGENE Census

**Spatial & multi-modal:**
- **omics.spatial_cluster** — Spatial transcriptomics clustering
- **omics.spatial_autocorrelation** — Spatial autocorrelation analysis
- **omics.cellxgene_search/fetch** — CELLxGENE Discover datasets
- **omics.cytof_cluster** — CyTOF/flow cytometry clustering
- **omics.multiomics_integrate** — MOFA+ multi-omics integration

**Workflow:** Search datasets → cluster cells → annotate cell types → trajectory analysis → marker gene discovery → spatial patterns.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeSafetySkill: OpenClawSkill = {
  name: 'celltype-safety-admet',
  description: 'Drug safety assessment, ADMET prediction, and adverse event analysis tools',
  instructions: `## Safety & ADMET Tools (celltype/cli)

Available tools for safety assessment:

- **safety.antitarget_profile** — Screen for anti-target degradation (tumor suppressors, heme TFs)
- **safety.classify** — Multi-modal SAFE/CAUTION/DANGEROUS classification
- **safety.sall4_risk** — SALL4 teratogenicity risk assessment
- **safety.faers_signal_scan** — FDA FAERS adverse event disproportionality signals
- **safety.label_risk_extract** — Extract boxed warnings from openFDA labels
- **safety.admet_predict** — ADMET property prediction from RDKit descriptors
- **safety.ddi_predict** — Drug-drug interaction potential

**PK tools:**
- **pk.nca_basic** — Noncompartmental PK analysis (Cmax/AUC/t1/2)

**Workflow:** ADMET prediction → anti-target screening → safety classification → FAERS signal scan → DDI check → PK analysis.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeClinicalSkill: OpenClawSkill = {
  name: 'celltype-clinical',
  description: 'Clinical trial search, indication mapping, and competitive landscape tools',
  instructions: `## Clinical Development Tools (celltype/cli)

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

**Workflow:** Indication mapping → population sizing → trial search → competitive landscape → trial design → protocol generation.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeLiteratureSkill: OpenClawSkill = {
  name: 'celltype-literature',
  description: 'Scientific literature search, ChEMBL queries, and patent analysis tools',
  instructions: `## Literature & Data API Tools (celltype/cli)

Available tools for literature and data access:

**Literature search:**
- **literature.pubmed_search** — PubMed via NCBI E-utilities
- **literature.chembl_query** — ChEMBL compound/SAR/target query
- **literature.openalex_search** — OpenAlex academic publications
- **literature.patent_search** — Patent search (Lens.org/EPO)
- **literature.preprint_search** — bioRxiv/medRxiv/arXiv preprints

**Broad data APIs:**
- **data_api.mygene_lookup** — MyGene.info gene data
- **data_api.mydisease_lookup** — MyDisease.info disease data
- **data_api.myvariant_lookup** — MyVariant.info variant data
- **data_api.mychem_lookup** — MyChem.info compound data
- **data_api.mytaxon_lookup** — MyTaxon.info taxonomy data
- **data_api.reactome_pathway_search** — Reactome pathway search

**Workflow:** Literature review → ChEMBL bioactivity data → patent landscape → preprint discovery.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeProteinSkill: OpenClawSkill = {
  name: 'celltype-protein-analysis',
  description: 'Protein function prediction, embeddings, domain annotation, and interaction network tools',
  instructions: `## Protein Analysis Tools (celltype/cli)

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

**Workflow:** Protein function → domain annotation → PPI network → pathway crosstalk → biomarker identification.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

export const celltypeViabilitySkill: OpenClawSkill = {
  name: 'celltype-viability',
  description: 'Cell viability dose-response, tissue selectivity, and drug repurposing tools',
  instructions: `## Viability & Drug Repurposing Tools (celltype/cli)

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

**Workflow:** Dose-response analysis → tissue selectivity → compound comparison → connectivity map query → repurposing candidates.`,
  source: 'plugin',
  pluginId: 'celltype-toolbox',
  enabled: true,
}

/**
 * All celltype skills in a single array for plugin registration.
 */
export const celltypeSkills: OpenClawSkill[] = [
  celltypeToolboxSkill,
  celltypeTargetSkill,
  celltypeStructureSkill,
  celltypeChemistrySkill,
  celltypeGenomicsSkill,
  celltypeTranscriptomicsSkill,
  celltypeSingleCellSkill,
  celltypeSafetySkill,
  celltypeClinicalSkill,
  celltypeLiteratureSkill,
  celltypeProteinSkill,
  celltypeViabilitySkill,
]
