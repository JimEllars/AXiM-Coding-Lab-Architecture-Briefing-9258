cat edge-coder-worker/src/ingress.ts.tmp > temp_header.ts
echo "" >> temp_header.ts
cat edge-coder-worker/src/ingress.ts >> temp_header.ts
mv temp_header.ts edge-coder-worker/src/ingress.ts
