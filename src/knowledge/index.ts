// Classes
export { EffectIndex } from './effect-index.js'
export { GlslIndex } from './glsl-index.js'
export { ShaderKnowledgeDB } from './vector-db.js'

// Types
export type { KnowledgeDocument, SearchResult, SearchOptions } from './vector-db.js'

// Shared instances
export { getSharedEffectIndex, invalidateSharedEffectIndex } from './shared-instances.js'

// Query utilities
export {
  expandQueryWithSynonyms,
  TECHNIQUE_SYNONYMS,
  SHADER_CRAFT_SYNONYMS,
  SEARCH_SYNONYMS,
  CURATED_KNOWLEDGE,
  SEARCHABLE_KNOWLEDGE,
} from './shader-knowledge.js'

// Search functions
export {
  searchShaderKnowledge,
  retrieveForAgent,
  getShaderKnowledgeDB,
  getKnowledgeByTopic,
} from './search-helpers.js'

// Loop-safe examples
export { retrieveLoopSafeExamples, searchByLoopPattern } from './loop-safe-examples.js'

// Innate knowledge
export { INNATE_SHADER_KNOWLEDGE, CRITICAL_RULES } from './innate-knowledge.js'

// Content modules
export { DSL_CRITICAL_RULES, DSL_SCAFFOLDING_PATTERNS, DSL_REFERENCE } from './dsl-knowledge.js'
export { EFFECT_CATALOG } from './effect-catalog.js'
export {
  EFFECT_DEFINITION_REFERENCE,
  EFFECT_DEFINITION_DEEP,
  EFFECT_ANATOMY_KNOWLEDGE,
  REQUIRED_PATTERNS,
} from './effect-definition.js'
export { GLSL_REFERENCE, GLSL_RECIPES } from './glsl-reference.js'
export { AGENT_WORKFLOW_KNOWLEDGE, COMPACT_SHADER_KNOWLEDGE } from './workflow-knowledge.js'

// DSL exemplars
export { DSL_EXEMPLAR_PATTERNS, DSL_EXEMPLAR_PROGRAMS, searchExemplars } from './dsl-exemplars.js'
export type { ExemplarProgram } from './dsl-exemplars.js'

// FSM state bundles
export {
  RESEARCH_KNOWLEDGE,
  PLAN_KNOWLEDGE,
  GENERATE_KNOWLEDGE,
  VALIDATE_KNOWLEDGE,
  FIX_KNOWLEDGE,
  FULL_SHADER_KNOWLEDGE,
  DSL_RESEARCH_KNOWLEDGE,
  DSL_PLAN_KNOWLEDGE,
  DSL_GENERATE_KNOWLEDGE,
  DSL_FIX_KNOWLEDGE,
} from './state-bundles.js'

// Shader craft: workflow, references, provenance, credits and the upstream licence
export {
  SHADER_CRAFT_CATEGORY,
  SHADER_CRAFT_WORKFLOW,
  SHADER_CRAFT_VIDEO_TO_EFFECT,
  SHADER_CRAFT_DOCUMENTS,
  SHADER_CRAFT_PROVENANCE,
  SHADER_CRAFT_CREDITS,
  SHADER_CRAFT_LICENSE,
} from './shader-craft/index.js'
export type {
  ShaderCraftProvenance,
  ShaderCraftCredits,
  ShaderCraftTechniqueCredit,
} from './shader-craft/index.js'
