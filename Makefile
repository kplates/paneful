.PHONY: dev build clean install

# Development: run frontend dev server + Rust backend concurrently
dev:
	@echo "Starting Vite dev server..."
	cd web && pnpm dev &
	@echo "Starting Rust backend in dev mode..."
	source "$$HOME/.cargo/env" && cargo run -- --dev --port 3000

# Production build: frontend → embed → single binary
build:
	cd web && pnpm install && pnpm build
	source "$$HOME/.cargo/env" && cargo build --release
	@echo ""
	@echo "Build complete: target/release/paneful"
	@ls -lh target/release/paneful

# Install to /usr/local/bin
install: build
	cp target/release/paneful /usr/local/bin/
	@echo "Installed paneful to /usr/local/bin/"

clean:
	cd web && rm -rf dist node_modules
	source "$$HOME/.cargo/env" && cargo clean
