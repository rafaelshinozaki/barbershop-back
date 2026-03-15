.PHONY: up down build logs shell clean restart status

# Build and start services
run:
	docker compose -f infra/compose.yaml up -d

# Stop and remove containers
stop:
	docker compose -f infra/compose.yaml down

# Build services
build:
	docker compose -f infra/compose.yaml build

# Build and start services (force rebuild)
rebuild:
	docker compose -f infra/compose.yaml up -d --build

# Show service logs
logs:
	docker compose -f infra/compose.yaml logs -f

# Open shell in backend container
shell:
	docker compose -f infra/compose.yaml exec backend /bin/bash

# Show service status
status:
	docker compose -f infra/compose.yaml ps

# Restart services
restart:
	docker compose -f infra/compose.yaml restart

# Clean up containers, networks, and volumes
clean:
	docker compose -f infra/compose.yaml down -v --remove-orphans
