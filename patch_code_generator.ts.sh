# edge-coder-worker/src/code_generator.ts looks like it already has assigned_model in CodingTaskPayload, executeCodingPipeline, requestCognitiveCodeGeneration, and reportLabExecutionTelemetry.

# check if assigned_model is in the file
grep -q "assigned_model?: string" edge-coder-worker/src/code_generator.ts && echo "assigned_model is in CodingTaskPayload"
grep -q "assigned_model =" edge-coder-worker/src/code_generator.ts && echo "assigned_model default is in executeCodingPipeline"
grep -q "assigned_model: string = \"deepseek-coder\"" edge-coder-worker/src/code_generator.ts && echo "assigned_model default is in requestCognitiveCodeGeneration"
grep -q "assigned_model: assigned_model" edge-coder-worker/src/code_generator.ts && echo "assigned_model is in reportLabExecutionTelemetry"
