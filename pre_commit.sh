npm run build
cd edge-coder-worker && npx typescript@latest/tsc src/*.ts --noEmit --esModuleInterop --target esnext --module commonjs
