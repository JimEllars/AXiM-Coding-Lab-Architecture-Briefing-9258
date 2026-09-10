if ! grep -q "payload.assigned_model =" src/services/labService.js; then
    sed -i '/const taskId = payload.task_id/a \
    if (!payload.assigned_model) {\
      const prefsStr = localStorage.getItem("axim_lab_preferences");\
      if (prefsStr) {\
        try {\
          const prefs = JSON.parse(prefsStr);\
          if (prefs.activeModel) payload.assigned_model = prefs.activeModel;\
        } catch (e) { console.error(e); }\
      }\
    }' src/services/labService.js
fi
