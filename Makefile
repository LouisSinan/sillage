# Sillage — the same targets on Linux and macOS; platform details live in scripts/.
.PHONY: install launch default update test uninstall

install:   ## Download Firefox and install the Sillage app
	@scripts/install.sh

launch:    ## Start Sillage
	@scripts/launch.sh

default:   ## Make Sillage the default web browser
	@scripts/default.sh

update:    ## Update the repository and Firefox
	@git pull --ff-only || true
	@scripts/install.sh --update

test:      ## Run the test suite in a headless Firefox on a throwaway profile
	@tests/run.sh

uninstall: ## Remove the app (keeps the profile)
	@scripts/uninstall.sh
