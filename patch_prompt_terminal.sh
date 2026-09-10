sed -i 's/let selectedModel = "deepseek-coder";/let selectedModel = "deepseek-coder";/g' src/components/PromptTerminal.jsx
# Ensure assigned_model is added to payloadBody if not already
if ! grep -q "assigned_model: selectedModel" src/components/PromptTerminal.jsx; then
    sed -i 's/runtime_env: targetRuntime/runtime_env: targetRuntime,\n        assigned_model: selectedModel/' src/components/PromptTerminal.jsx
fi
