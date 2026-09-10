cat << 'INNER_EOF' > temp_script.sh
awk '
/const limit = parseInt/ {
  print "        let dlq_pending_count = 0;"
  print "        if (env.CODER_DLQ_KV) {"
  print "          const dlqList = await env.CODER_DLQ_KV.list({ prefix: \x27dlq:\x27 });"
  print "          dlq_pending_count = dlqList.keys.length;"
  print "        }"
  print $0
  next
}
/memory_execution_markers:/ {
  print $0
  print "          dlq_pending_count,"
  next
}
{ print }
' edge-coder-worker/src/ingress.ts > temp.ts && mv temp.ts edge-coder-worker/src/ingress.ts
INNER_EOF
bash temp_script.sh
