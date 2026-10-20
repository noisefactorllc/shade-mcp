import record from './provenance.json'

/**
 * Where the shader-craft knowledge came from. provenance.json is the record;
 * this module types it and carries it into the knowledge bundle.
 *
 * To bring in an upstream update, compare each file's `blob` with the blob at
 * the newer commit (the git tree of that commit lists them), and port the
 * changed files into the documents named in `adaptedAs`.
 */
export interface ShaderCraftProvenance {
  name: string
  description: string
  upstream: {
    /** owner/name on `host`. */
    repository: string
    host: string
    /** Full commit hash the adaptation was made from. */
    commit: string
    /** Commit date, ISO 8601 UTC. */
    date: string
    license: string
    copyright: string
  }
  adaptation: {
    target: string
    /** Date the adapted copy was made. */
    adapted: string
  }
  files: Array<{
    /** Path in the upstream repository. */
    path: string
    /** Git blob hash of the file at `upstream.commit`. */
    blob: string
    /** Document ids and exported names that carry this file's adaptation. */
    adaptedAs: string[]
  }>
}

export const SHADER_CRAFT_PROVENANCE: ShaderCraftProvenance = record
