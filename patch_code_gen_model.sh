sed -i 's/const modifiedCode = await requestCognitiveCodeGeneration(safeContent, instruction_prompt, runtime_env, dependenciesContext, env);/const modifiedCode = await requestCognitiveCodeGeneration(safeContent, instruction_prompt, runtime_env, dependenciesContext, env, assigned_model);/' edge-coder-worker/src/code_generator.ts

sed -i 's/async function requestCognitiveCodeGeneration(currentCode: string, instructions: string, runtime_env: string, dependenciesContext: string, env: Env): Promise<string> {/async function requestCognitiveCodeGeneration(currentCode: string, instructions: string, runtime_env: string, dependenciesContext: string, env: Env, assigned_model: string = "deepseek-coder"): Promise<string> {/' edge-coder-worker/src/code_generator.ts

sed -i "s/model: 'deepseek-coder',/model: assigned_model,/" edge-coder-worker/src/code_generator.ts
