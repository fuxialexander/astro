#!/bin/bash

# Astro Setup Verification Script
# This script checks if the development environment is properly configured

set -e

echo "🔍 Verifying Astro development environment setup..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track overall status
ERRORS=0
WARNINGS=0

# Function to print success
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print error
print_error() {
    echo -e "${RED}✗${NC} $1"
    ERRORS=$((ERRORS + 1))
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

# Check Node.js version
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    REQUIRED_VERSION="v25.6.0"
    if [ "$NODE_VERSION" = "$REQUIRED_VERSION" ]; then
        print_success "Node.js version: $NODE_VERSION"
    else
        print_warning "Node.js version: $NODE_VERSION (recommended: $REQUIRED_VERSION)"
    fi
else
    print_error "Node.js is not installed"
fi

# Check npm version
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    print_success "npm version: $NPM_VERSION"
else
    print_error "npm is not installed"
fi

# Check if node_modules exists
echo "Checking dependencies..."
if [ -d "node_modules" ]; then
    print_success "Dependencies installed"
else
    print_warning "Dependencies not installed. Run 'npm install'"
fi

# Check Git
echo "Checking Git..."
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version)
    print_success "$GIT_VERSION"
else
    print_error "Git is not installed"
fi

# Check if in a git repository
if [ -d ".git" ]; then
    print_success "Git repository initialized"
else
    print_error "Not in a git repository"
fi

# Check required files
echo "Checking project files..."
FILES=(
    "package.json"
    "tsconfig.json"
    "vite.config.ts"
    "README.md"
    "CONTRIBUTING.md"
    ".gitignore"
    ".editorconfig"
    ".nvmrc"
)

for FILE in "${FILES[@]}"; do
    if [ -f "$FILE" ]; then
        print_success "$FILE exists"
    else
        print_error "$FILE is missing"
    fi
done

# Check directories
echo "Checking project directories..."
DIRS=(
    "src"
    "server"
    "public"
    ".github/workflows"
)

for DIR in "${DIRS[@]}"; do
    if [ -d "$DIR" ]; then
        print_success "$DIR/ exists"
    else
        print_error "$DIR/ is missing"
    fi
done

# Check TypeScript
echo "Checking TypeScript..."
if [ -f "node_modules/.bin/tsc" ]; then
    TSC_VERSION=$(./node_modules/.bin/tsc --version)
    print_success "TypeScript: $TSC_VERSION"
else
    print_warning "TypeScript not found in node_modules"
fi

# Check ESLint
echo "Checking ESLint..."
if [ -f "eslint.config.js" ]; then
    print_success "ESLint config exists"
else
    print_warning "ESLint config not found"
fi

# Check ports availability
echo "Checking port availability..."
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    print_warning "Port 5173 (Vite) is already in use"
else
    print_success "Port 5173 (Vite) is available"
fi

if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    print_warning "Port 3001 (Backend) is already in use"
else
    print_success "Port 3001 (Backend) is available"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! You're ready to develop.${NC}"
    echo ""
    echo "Run 'npm run dev' to start the development server."
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Setup complete with $WARNINGS warning(s).${NC}"
    echo "You can still develop, but consider addressing the warnings."
else
    echo -e "${RED}✗ Setup incomplete: $ERRORS error(s), $WARNINGS warning(s).${NC}"
    echo "Please address the errors before continuing."
    exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
