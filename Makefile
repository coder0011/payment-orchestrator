.PHONY: all build test test-unit test-security test-e2e loadtest demo run clean

all: build test

build:
	npm run build

test:
	npm test

test-unit:
	npm run test:unit

test-security:
	npm run test:security

test-e2e:
	npm run test:e2e

loadtest:
	npm run test:load

demo:
	@if [ -f "./scripts/demo.sh" ]; then bash ./scripts/demo.sh; else powershell -ExecutionPolicy Bypass -File ./scripts/demo.ps1; fi

docker-build:
	docker build -t techdome-payment-orchestrator:latest .

docker-run:
	docker-compose up --build -d

docker-down:
	docker-compose down

clean:
	rm -rf dist node_modules coverage
