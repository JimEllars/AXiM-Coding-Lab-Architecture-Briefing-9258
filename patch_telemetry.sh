sed -i 's/async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env, cfRay?: string, truncated: boolean = false, runtimeEnv: string = '"'"'Node.js Edge'"'"'): Promise<void> {/async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env, cfRay?: string, truncated: boolean = false, runtimeEnv: string = '"'"'Node.js Edge'"'"', assigned_model?: string): Promise<void> {/' edge-coder-worker/src/code_generator.ts

sed -i 's/runtime_env: runtimeEnv/runtime_env: runtimeEnv,\n        assigned_model: assigned_model/' edge-coder-worker/src/code_generator.ts

sed -i 's/await reportLabExecutionTelemetry(task_id, origin_source, prUrl, env, cf_ray, truncated, runtime_env);/await reportLabExecutionTelemetry(task_id, origin_source, prUrl, env, cf_ray, truncated, runtime_env, assigned_model);/' edge-coder-worker/src/code_generator.ts

sed -i 's/await reportLabExecutionTelemetry(taskId, task.requestedBy || '"'"'Autonomous'"'"', prUrl, env);/await reportLabExecutionTelemetry(taskId, task.requestedBy || '"'"'Autonomous'"'"', prUrl, env, undefined, undefined, '"'"'Node.js Edge'"'"', '"'"'deepseek-coder'"'"');/' edge-coder-worker/src/code_generator.ts
