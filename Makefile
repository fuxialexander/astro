# Nexus Makefile
# Convenience commands for common development tasks

.PHONY: help install dev build clean test lint format verify docker-build docker-up docker-down

# Default target
help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install

dev: ## Start development server (frontend + backend)
	npm run dev

dev-frontend: ## Start frontend development server only
	npm run dev:frontend

dev-backend: ## Start backend development server only
	npm run dev:backend

build: ## Build for production
	npm run build

clean: ## Clean build artifacts and dependencies
	rm -rf dist/ node_modules/ .wrangler/
	rm -f package-lock.json

test: ## Run tests
	npm test

lint: ## Run linter
	npm run lint

format: ## Format code (if configured)
	@echo "Formatting not configured yet. Run: npm install -D prettier"

verify: ## Verify development environment setup
	npm run verify

# Docker commands
docker-build: ## Build Docker image
	docker build -t nexus:latest .

docker-build-dev: ## Build Docker image for development
	docker build --target builder -t nexus:dev .

docker-up: ## Start Docker Compose services
	docker-compose up -d

docker-up-dev: ## Start Docker Compose in development mode
	docker-compose --profile dev up -d

docker-down: ## Stop Docker Compose services
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f

docker-clean: ## Remove Docker containers and volumes
	docker-compose down -v
	docker rmi nexus:latest nexus:dev 2>/dev/null || true

# Environment setup
env: ## Create .env file from .env.example
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo ".env file created. Please edit it with your configuration."; \
	else \
		echo ".env file already exists."; \
	fi

# Git commands
commit: lint ## Run linter before committing
	@echo "Linting passed. Ready to commit."

pre-push: lint test ## Run checks before pushing
	@echo "All checks passed. Ready to push."

# Database commands (if using Supabase locally)
db-start: ## Start local Supabase
	cd supabase && supabase start

db-stop: ## Stop local Supabase
	cd supabase && supabase stop

db-reset: ## Reset local database (CAUTION: deletes all data)
	cd supabase && supabase db reset

db-migrate: ## Run database migrations
	cd supabase && supabase migration up

# Redis commands
redis-start: ## Start Redis server
	@if command -v redis-server > /dev/null; then \
		redis-server --daemonize yes; \
		echo "Redis started"; \
	else \
		echo "Redis not installed. Install with: brew install redis"; \
	fi

redis-stop: ## Stop Redis server
	@if command -v redis-cli > /dev/null; then \
		redis-cli shutdown; \
		echo "Redis stopped"; \
	else \
		echo "Redis not installed"; \
	fi

redis-cli: ## Open Redis CLI
	redis-cli

# Deployment
deploy: build ## Deploy to Cloudflare Pages
	npm run deploy

deploy-check: ## Check deployment configuration
	@echo "Checking deployment configuration..."
	@if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then \
		echo "Warning: CLOUDFLARE_API_TOKEN not set"; \
	else \
		echo "CLOUDFLARE_API_TOKEN is set"; \
	fi

# Project information
info: ## Show project information
	@echo "Nexus - Distributed Task Planning and Execution System"
	@echo ""
	@echo "Node.js version: $$(node --version)"
	@echo "npm version: $$(npm --version)"
	@echo "Project version: $$(node -p "require('./package.json').version")"
	@echo ""
	@echo "Frontend: http://localhost:5173"
	@echo "Backend: http://localhost:3001"
	@echo "Relay: ws://localhost:3002"

# Quick start
quickstart: install env verify dev ## Quick start: install, configure, verify, and run

# CI simulation
ci: lint build ## Simulate CI pipeline locally
	@echo "CI checks passed!"
