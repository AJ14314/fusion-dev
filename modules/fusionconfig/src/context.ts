import { cliContext, CliContext, CliTc, fixedConfig } from "@itsmworkbench/cli";
import { YamlCapability } from "@itsmworkbench/yaml";
import { FileOps } from "@laoban/fileops";
import { fileOpsNode } from "@laoban/filesops-node";
import { jsYaml } from "@itsmworkbench/jsyaml";
import { Commander12, commander12Tc } from "@itsmworkbench/commander12";
import { NoConfig } from "../index";
import { LoadFilesFn } from "@fusionconfig/config";
import { findConfigUsingFileops } from "@fusionconfig/fileopsconfig";
import { addTaskSchemasToServices, PostProcessor, SchemaNameFn } from "@fusionconfig/config/dist/src/post.process";

export type HasYaml = {
  yaml: YamlCapability
}
export interface ThereAndBackContext extends CliContext, HasYaml {
  loadFiles: LoadFilesFn
  postProcessors: PostProcessor[]
}

export function postProcessors ( schemaNameFn: SchemaNameFn ): PostProcessor[] {
  return [
    addTaskSchemasToServices ( schemaNameFn )
  ]
}

export function makeContext ( version: string, schemaNameFn: SchemaNameFn ): ThereAndBackContext {
  return thereAndBackContext ( 'fusion', version, fileOpsNode (), jsYaml (), schemaNameFn )
}
export const cliTc: CliTc<Commander12, ThereAndBackContext, NoConfig, NoConfig> = commander12Tc<ThereAndBackContext, NoConfig, NoConfig> ()
export const configFinder = fixedConfig<NoConfig> ( makeContext )

export function thereAndBackContext ( name: string, version: string, fileOps: FileOps, yaml: YamlCapability, schemaNameFn: SchemaNameFn ): ThereAndBackContext {
  return { ...cliContext ( name, version, fileOps ), yaml, loadFiles: findConfigUsingFileops ( fileOps, yaml ), postProcessors: postProcessors ( schemaNameFn ) }
}